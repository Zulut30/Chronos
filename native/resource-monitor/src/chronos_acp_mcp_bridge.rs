use serde_json::{Value, json};
use std::io::{self, BufRead, BufReader, BufWriter, Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;

const WORKER_STACK_BYTES: usize = 512 * 1024;
const MISSING_ENV_MESSAGE: &str =
    "acp-mcp-bridge requires T3_ACP_MCP_ENDPOINT and T3_ACP_MCP_AUTHORIZATION.\n";

#[derive(Debug, Clone, PartialEq, Eq)]
struct HttpEndpoint {
    connect_addr: String,
    host_header: String,
    path: String,
}

fn parse_http_endpoint(raw: &str) -> Result<HttpEndpoint, String> {
    let rest = raw
        .strip_prefix("http://")
        .ok_or_else(|| format!("unsupported MCP endpoint scheme: {raw}"))?;
    let path_start = rest.find(['/', '?']).unwrap_or(rest.len());
    let authority = &rest[..path_start];
    if authority.is_empty() {
        return Err("missing MCP endpoint host".to_owned());
    }
    let path = if path_start == rest.len() {
        "/".to_owned()
    } else if rest.as_bytes()[path_start] == b'?' {
        format!("/{}", &rest[path_start..])
    } else {
        rest[path_start..].to_owned()
    };

    let (connect_addr, host_header) = if let Some(after_bracket) = authority.strip_prefix('[') {
        let end_bracket = after_bracket
            .find(']')
            .ok_or_else(|| format!("invalid IPv6 MCP endpoint authority: {authority}"))?;
        let host = &after_bracket[..end_bracket];
        let after = &after_bracket[end_bracket + 1..];
        let port = if after.is_empty() {
            80u16
        } else if let Some(port_str) = after.strip_prefix(':') {
            port_str
                .parse::<u16>()
                .map_err(|_| format!("invalid MCP endpoint port: {port_str}"))?
        } else {
            return Err(format!("invalid MCP endpoint authority: {authority}"));
        };
        (format!("[{host}]:{port}"), authority.to_owned())
    } else if let Some((host, port_str)) = authority.rsplit_once(':') {
        if host.is_empty() {
            return Err(format!("missing MCP endpoint host: {authority}"));
        }
        let port = port_str
            .parse::<u16>()
            .map_err(|_| format!("invalid MCP endpoint port: {port_str}"))?;
        (format!("{host}:{port}"), authority.to_owned())
    } else {
        (format!("{authority}:80"), authority.to_owned())
    };

    Ok(HttpEndpoint {
        connect_addr,
        host_header,
        path,
    })
}

#[derive(Default)]
struct SessionState {
    session_id: Option<String>,
    protocol_version: Option<String>,
}

struct BarrierState {
    issued: u64,
    completed: u64,
}

struct SessionBarrier {
    state: Mutex<BarrierState>,
    cond: Condvar,
}

impl SessionBarrier {
    fn new() -> Self {
        Self {
            state: Mutex::new(BarrierState {
                issued: 0,
                completed: 0,
            }),
            cond: Condvar::new(),
        }
    }

    fn issue_handshake_ticket(&self) -> u64 {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.issued += 1;
        state.issued
    }

    fn current_issued(&self) -> u64 {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.issued
    }

    fn wait_for(&self, target: u64) {
        if target == 0 {
            return;
        }
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        while state.completed < target {
            state = self.cond.wait(state).unwrap_or_else(|e| e.into_inner());
        }
    }

    fn complete_ticket(&self, ticket: u64) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if ticket > state.completed {
            state.completed = ticket;
        }
        self.cond.notify_all();
    }
}

struct HandshakeGuard {
    barrier: Arc<SessionBarrier>,
    ticket: u64,
}

impl Drop for HandshakeGuard {
    fn drop(&mut self) {
        self.barrier.complete_ticket(self.ticket);
    }
}

struct BridgeContext<W: Write + Send + 'static> {
    endpoint: HttpEndpoint,
    authorization: String,
    session: Mutex<SessionState>,
    output: Mutex<W>,
}

impl<W: Write + Send + 'static> BridgeContext<W> {
    fn write_json_line(&self, value: &Value) {
        if let Ok(serialized) = serde_json::to_string(value) {
            let mut out = self.output.lock().unwrap_or_else(|e| e.into_inner());
            let _ = out.write_all(serialized.as_bytes());
            let _ = out.write_all(b"\n");
            let _ = out.flush();
        }
    }

    fn respond_with_error(&self, request_id: Option<&Value>, message: &str, code: i64) {
        let id = request_id.cloned().unwrap_or(Value::Null);
        self.write_json_line(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message },
        }));
    }

    fn handle_server_payload(&self, payload: Value) {
        let entries = match payload {
            Value::Array(items) => items,
            single => vec![single],
        };
        for entry in entries {
            if let Some(version) = entry
                .get("result")
                .and_then(|r| r.get("protocolVersion"))
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty())
            {
                let mut session = self.session.lock().unwrap_or_else(|e| e.into_inner());
                session.protocol_version = Some(version.to_owned());
            }
            self.write_json_line(&entry);
        }
    }

    fn forward(&self, line: &str, request_id: Option<Value>) {
        if let Err(error) = self.forward_inner(line, request_id.as_ref()) {
            if let Some(id) = request_id.as_ref() {
                self.respond_with_error(
                    Some(id),
                    &format!("T3 Code MCP bridge request failed: {error}"),
                    -32603,
                );
            }
        }
    }

    fn forward_inner(&self, line: &str, request_id: Option<&Value>) -> Result<(), String> {
        let (session_id, protocol_version) = {
            let session = self.session.lock().unwrap_or_else(|e| e.into_inner());
            (session.session_id.clone(), session.protocol_version.clone())
        };

        let mut stream = TcpStream::connect(&self.endpoint.connect_addr)
            .map_err(|e| format!("connect {}: {e}", self.endpoint.connect_addr))?;
        let _ = stream.set_nodelay(true);

        let body_bytes = line.as_bytes();
        let mut req = String::with_capacity(256 + body_bytes.len());
        req.push_str("POST ");
        req.push_str(&self.endpoint.path);
        req.push_str(" HTTP/1.1\r\nHost: ");
        req.push_str(&self.endpoint.host_header);
        req.push_str(
            "\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nAuthorization: ",
        );
        req.push_str(&self.authorization);
        if let Some(sid) = session_id.as_deref() {
            req.push_str("\r\nMcp-Session-Id: ");
            req.push_str(sid);
        }
        if let Some(pv) = protocol_version.as_deref() {
            req.push_str("\r\nMcp-Protocol-Version: ");
            req.push_str(pv);
        }
        req.push_str("\r\nContent-Length: ");
        req.push_str(&body_bytes.len().to_string());
        req.push_str("\r\nConnection: close\r\n\r\n");

        stream
            .write_all(req.as_bytes())
            .and_then(|_| stream.write_all(body_bytes))
            .and_then(|_| stream.flush())
            .map_err(|e| format!("write request: {e}"))?;

        let mut reader = BufReader::new(stream);
        let status_line = read_http_line(&mut reader).map_err(|e| format!("read status: {e}"))?;
        let status_code = parse_status_code(&status_line)?;

        let mut response_session_id: Option<String> = None;
        let mut content_type = String::new();
        let mut is_chunked = false;
        let mut content_length: Option<u64> = None;

        loop {
            let header_line =
                read_http_line(&mut reader).map_err(|e| format!("read header: {e}"))?;
            if header_line.is_empty() {
                break;
            }
            if let Some((name, value)) = header_line.split_once(':') {
                let name_lower = name.trim().to_ascii_lowercase();
                let value_trimmed = value.trim();
                match name_lower.as_str() {
                    "mcp-session-id" if !value_trimmed.is_empty() => {
                        response_session_id = Some(value_trimmed.to_owned());
                    }
                    "content-type" => {
                        content_type = value_trimmed
                            .split(';')
                            .next()
                            .unwrap_or("")
                            .trim()
                            .to_ascii_lowercase();
                    }
                    "transfer-encoding" => {
                        if value_trimmed
                            .split(',')
                            .any(|token| token.trim().eq_ignore_ascii_case("chunked"))
                        {
                            is_chunked = true;
                        }
                    }
                    "content-length" => {
                        if let Ok(len) = value_trimmed.parse::<u64>() {
                            content_length = Some(len);
                        }
                    }
                    _ => {}
                }
            }
        }

        if let Some(sid) = response_session_id {
            let mut session = self.session.lock().unwrap_or_else(|e| e.into_inner());
            session.session_id = Some(sid);
        }

        if !(200..300).contains(&status_code) {
            if let Some(id) = request_id {
                self.respond_with_error(
                    Some(id),
                    &format!("T3 Code MCP endpoint responded with HTTP {status_code}."),
                    -32603,
                );
            }
            return Ok(());
        }

        if status_code == 202 || status_code == 204 {
            return Ok(());
        }

        if is_chunked {
            let mut chunked = ChunkedReader::new(reader);
            self.consume_body(&mut chunked, &content_type)
        } else if let Some(len) = content_length {
            let mut limited = reader.take(len);
            self.consume_body(&mut limited, &content_type)
        } else {
            self.consume_body(&mut reader, &content_type)
        }
    }

    fn consume_body<R: Read>(&self, body: &mut R, content_type: &str) -> Result<(), String> {
        if content_type == "text/event-stream" {
            let mut buf = [0u8; 4096];
            let mut pending_utf8: Vec<u8> = Vec::new();
            let mut sse_text = String::new();
            loop {
                let n = body.read(&mut buf).map_err(|e| format!("read SSE: {e}"))?;
                if n == 0 {
                    break;
                }
                pending_utf8.extend_from_slice(&buf[..n]);
                drain_valid_utf8(&mut pending_utf8, &mut sse_text);
                while let Some((sep_idx, sep_len)) = find_sse_separator(&sse_text) {
                    let data = extract_sse_data(&sse_text[..sep_idx]);
                    sse_text.drain(..sep_idx + sep_len);
                    if !data.is_empty() {
                        let payload: Value = serde_json::from_str(&data)
                            .map_err(|e| format!("parse SSE JSON: {e}"))?;
                        self.handle_server_payload(payload);
                    }
                }
            }
            if !pending_utf8.is_empty() {
                sse_text.push_str(&String::from_utf8_lossy(&pending_utf8));
                while let Some((sep_idx, sep_len)) = find_sse_separator(&sse_text) {
                    let data = extract_sse_data(&sse_text[..sep_idx]);
                    sse_text.drain(..sep_idx + sep_len);
                    if !data.is_empty() {
                        let payload: Value = serde_json::from_str(&data)
                            .map_err(|e| format!("parse SSE JSON: {e}"))?;
                        self.handle_server_payload(payload);
                    }
                }
            }
            return Ok(());
        }

        let mut raw = Vec::new();
        body.read_to_end(&mut raw)
            .map_err(|e| format!("read body: {e}"))?;
        let text = String::from_utf8_lossy(&raw);
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            let payload: Value =
                serde_json::from_str(trimmed).map_err(|e| format!("parse JSON response: {e}"))?;
            self.handle_server_payload(payload);
        }
        Ok(())
    }
}

fn read_http_line<R: BufRead>(reader: &mut R) -> io::Result<String> {
    let mut raw = Vec::new();
    let n = reader.read_until(b'\n', &mut raw)?;
    if n == 0 {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "unexpected EOF while reading HTTP header",
        ));
    }
    while matches!(raw.last(), Some(b'\n' | b'\r')) {
        raw.pop();
    }
    Ok(String::from_utf8_lossy(&raw).into_owned())
}

fn parse_status_code(status_line: &str) -> Result<u16, String> {
    let mut parts = status_line.split_whitespace();
    let version = parts
        .next()
        .ok_or_else(|| format!("malformed HTTP status line: {status_line}"))?;
    if !version.starts_with("HTTP/") {
        return Err(format!("malformed HTTP status line: {status_line}"));
    }
    let code_str = parts
        .next()
        .ok_or_else(|| format!("missing HTTP status code: {status_line}"))?;
    code_str
        .parse::<u16>()
        .map_err(|_| format!("invalid HTTP status code: {code_str}"))
}

struct ChunkedReader<R: BufRead> {
    inner: R,
    remaining: usize,
    eof: bool,
}

impl<R: BufRead> ChunkedReader<R> {
    fn new(inner: R) -> Self {
        Self {
            inner,
            remaining: 0,
            eof: false,
        }
    }

    fn consume_crlf(&mut self) -> io::Result<()> {
        let mut line = Vec::new();
        let _ = self.inner.read_until(b'\n', &mut line)?;
        Ok(())
    }
}

impl<R: BufRead> Read for ChunkedReader<R> {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if self.eof || out.is_empty() {
            return Ok(0);
        }
        if self.remaining == 0 {
            let size_line = match read_http_line(&mut self.inner) {
                Ok(line) => line,
                Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => {
                    self.eof = true;
                    return Ok(0);
                }
                Err(error) => return Err(error),
            };
            let hex = size_line.split(';').next().unwrap_or("").trim();
            let chunk_size = usize::from_str_radix(hex, 16).map_err(|_| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("invalid HTTP chunk size: {size_line}"),
                )
            })?;
            if chunk_size == 0 {
                // Consume optional trailer lines until the terminating empty line.
                loop {
                    let trailer = read_http_line(&mut self.inner)?;
                    if trailer.is_empty() {
                        break;
                    }
                }
                self.eof = true;
                return Ok(0);
            }
            self.remaining = chunk_size;
        }
        let max_read = out.len().min(self.remaining);
        let n = self.inner.read(&mut out[..max_read])?;
        if n == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "unexpected EOF inside HTTP chunk",
            ));
        }
        self.remaining -= n;
        if self.remaining == 0 {
            self.consume_crlf()?;
        }
        Ok(n)
    }
}

fn drain_valid_utf8(pending: &mut Vec<u8>, target: &mut String) {
    loop {
        match std::str::from_utf8(pending) {
            Ok(valid) => {
                target.push_str(valid);
                pending.clear();
                break;
            }
            Err(error) => {
                let valid_up_to = error.valid_up_to();
                if valid_up_to > 0 {
                    if let Ok(valid) = std::str::from_utf8(&pending[..valid_up_to]) {
                        target.push_str(valid);
                    }
                    pending.drain(..valid_up_to);
                }
                if let Some(error_len) = error.error_len() {
                    target.push('\u{FFFD}');
                    pending.drain(..error_len);
                } else {
                    break;
                }
            }
        }
    }
}

fn find_sse_separator(text: &str) -> Option<(usize, usize)> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\r' => {
                if i + 3 < bytes.len()
                    && bytes[i + 1] == b'\n'
                    && bytes[i + 2] == b'\r'
                    && bytes[i + 3] == b'\n'
                {
                    return Some((i, 4));
                }
                if i + 1 < bytes.len() && bytes[i + 1] == b'\r' {
                    return Some((i, 2));
                }
            }
            b'\n' => {
                if i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
                    return Some((i, 2));
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn extract_sse_data(raw_event: &str) -> String {
    let mut parts = Vec::new();
    let mut rest = raw_event;
    while !rest.is_empty() {
        let (line, next) = match rest.find(['\r', '\n']) {
            Some(idx) => {
                let mut skip = 1;
                if rest.as_bytes()[idx] == b'\r' && rest.as_bytes().get(idx + 1) == Some(&b'\n') {
                    skip = 2;
                }
                (&rest[..idx], &rest[idx + skip..])
            }
            None => (rest, ""),
        };
        if let Some(payload) = line.strip_prefix("data:") {
            parts.push(payload.trim_start());
        }
        rest = next;
    }
    parts.join("\n")
}

fn run_bridge<R: Read, W: Write + Send + 'static>(
    endpoint_raw: &str,
    authorization: &str,
    mut input: R,
    output: W,
) -> Result<(), String> {
    let endpoint = parse_http_endpoint(endpoint_raw)?;
    let ctx = Arc::new(BridgeContext {
        endpoint,
        authorization: authorization.to_owned(),
        session: Mutex::new(SessionState::default()),
        output: Mutex::new(output),
    });
    let barrier = Arc::new(SessionBarrier::new());
    let mut handles: Vec<thread::JoinHandle<()>> = Vec::new();

    let mut dispatch_line = |raw_line: &[u8]| {
        handles.retain(|h| !h.is_finished());
        let line = String::from_utf8_lossy(raw_line).into_owned();
        if line.trim().is_empty() {
            return;
        }
        let parsed: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                ctx.respond_with_error(None, "Parse error", -32700);
                return;
            }
        };
        let Some(obj) = parsed.as_object() else {
            return;
        };
        let request_id = obj.get("id").cloned();
        let method = obj.get("method").and_then(Value::as_str);
        let is_response =
            request_id.is_some() && (obj.contains_key("result") || obj.contains_key("error"));
        let is_session_handshake = matches!(
            method,
            Some("initialize") | Some("notifications/initialized")
        );

        let ctx_clone = Arc::clone(&ctx);
        let barrier_clone = Arc::clone(&barrier);

        let spawn_result = if is_response {
            thread::Builder::new()
                .stack_size(WORKER_STACK_BYTES)
                .spawn(move || {
                    ctx_clone.forward(&line, request_id);
                })
        } else if is_session_handshake {
            let ticket = barrier.issue_handshake_ticket();
            thread::Builder::new()
                .stack_size(WORKER_STACK_BYTES)
                .spawn(move || {
                    let _guard = HandshakeGuard {
                        barrier: Arc::clone(&barrier_clone),
                        ticket,
                    };
                    barrier_clone.wait_for(ticket - 1);
                    ctx_clone.forward(&line, request_id);
                })
        } else {
            let wait_for = barrier.current_issued();
            thread::Builder::new()
                .stack_size(WORKER_STACK_BYTES)
                .spawn(move || {
                    barrier_clone.wait_for(wait_for);
                    ctx_clone.forward(&line, request_id);
                })
        };

        match spawn_result {
            Ok(handle) => handles.push(handle),
            Err(error) => {
                if let Some(id) = obj.get("id") {
                    ctx.respond_with_error(
                        Some(id),
                        &format!("T3 Code MCP bridge request failed: {error}"),
                        -32603,
                    );
                }
            }
        }
    };

    // Split stdin strictly on CR/LF bytes so U+2028/U+2029 and split multi-byte UTF-8 remain intact.
    let mut read_buf = [0u8; 4096];
    let mut pending: Vec<u8> = Vec::new();
    while let Ok(n) = input.read(&mut read_buf) {
        if n == 0 {
            break;
        }
        pending.extend_from_slice(&read_buf[..n]);
        let mut start = 0;
        let mut i = 0;
        while i < pending.len() {
            match pending[i] {
                b'\n' => {
                    dispatch_line(&pending[start..i]);
                    start = i + 1;
                }
                b'\r' => {
                    if i + 1 < pending.len() {
                        dispatch_line(&pending[start..i]);
                        if pending[i + 1] == b'\n' {
                            i += 1;
                        }
                        start = i + 1;
                    } else {
                        break;
                    }
                }
                _ => {}
            }
            i += 1;
        }
        if start > 0 {
            pending.drain(..start);
        }
    }

    if !pending.is_empty() {
        let mut start = 0;
        let mut i = 0;
        while i < pending.len() {
            if pending[i] == b'\n' || pending[i] == b'\r' {
                dispatch_line(&pending[start..i]);
                if pending[i] == b'\r' && i + 1 < pending.len() && pending[i + 1] == b'\n' {
                    i += 1;
                }
                start = i + 1;
            }
            i += 1;
        }
        if start < pending.len() {
            dispatch_line(&pending[start..]);
        }
    }

    for handle in handles {
        let _ = handle.join();
    }
    Ok(())
}

pub fn run_cli() -> i32 {
    let endpoint = std::env::var("T3_ACP_MCP_ENDPOINT").ok();
    let authorization = std::env::var("T3_ACP_MCP_AUTHORIZATION").ok();
    let (Some(endpoint), Some(authorization)) = (endpoint, authorization) else {
        let _ = io::stderr().write_all(MISSING_ENV_MESSAGE.as_bytes());
        return 2;
    };
    let stdin = io::stdin();
    let stdout = BufWriter::new(io::stdout());
    if let Err(error) = run_bridge(&endpoint, &authorization, stdin.lock(), stdout) {
        let _ = writeln!(io::stderr(), "acp-mcp-bridge failed: {error}");
        return 1;
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::io::Cursor;
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::time::Duration;

    struct SharedWriter {
        lines: Arc<Mutex<Vec<u8>>>,
        notify: Option<mpsc::Sender<String>>,
        partial: Vec<u8>,
    }

    impl SharedWriter {
        fn new(notify: Option<mpsc::Sender<String>>) -> (Self, Arc<Mutex<Vec<u8>>>) {
            let lines = Arc::new(Mutex::new(Vec::new()));
            (
                Self {
                    lines: Arc::clone(&lines),
                    notify,
                    partial: Vec::new(),
                },
                lines,
            )
        }
    }

    impl Write for SharedWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.lines.lock().unwrap().extend_from_slice(buf);
            if let Some(tx) = &self.notify {
                self.partial.extend_from_slice(buf);
                while let Some(pos) = self.partial.iter().position(|&b| b == b'\n') {
                    let line = String::from_utf8_lossy(&self.partial[..pos]).into_owned();
                    self.partial.drain(..=pos);
                    let _ = tx.send(line);
                }
            }
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    struct ChannelReader {
        rx: mpsc::Receiver<Vec<u8>>,
        current: Vec<u8>,
        offset: usize,
    }

    impl Read for ChannelReader {
        fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
            if self.offset >= self.current.len() {
                match self.rx.recv() {
                    Ok(chunk) => {
                        self.current = chunk;
                        self.offset = 0;
                    }
                    Err(_) => return Ok(0),
                }
            }
            let available = &self.current[self.offset..];
            let count = out.len().min(available.len());
            out[..count].copy_from_slice(&available[..count]);
            self.offset += count;
            Ok(count)
        }
    }

    fn read_http_request(stream: &mut TcpStream) -> (HashMap<String, String>, String) {
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let _request_line = read_http_line(&mut reader).unwrap();
        let mut headers = HashMap::new();
        let mut content_length = 0usize;
        loop {
            let line = read_http_line(&mut reader).unwrap();
            if line.is_empty() {
                break;
            }
            if let Some((k, v)) = line.split_once(':') {
                let key = k.trim().to_ascii_lowercase();
                let val = v.trim().to_owned();
                if key == "content-length" {
                    content_length = val.parse().unwrap_or(0);
                }
                headers.insert(key, val);
            }
        }
        let mut body = vec![0u8; content_length];
        reader.read_exact(&mut body).unwrap();
        (headers, String::from_utf8(body).unwrap())
    }

    fn write_chunk(stream: &mut TcpStream, data: &[u8]) {
        let header = format!("{:x}\r\n", data.len());
        stream.write_all(header.as_bytes()).unwrap();
        stream.write_all(data).unwrap();
        stream.write_all(b"\r\n").unwrap();
        stream.flush().unwrap();
    }

    #[test]
    fn parses_loopback_http_endpoints() {
        assert_eq!(
            parse_http_endpoint("http://127.0.0.1:43123/mcp?x=1").unwrap(),
            HttpEndpoint {
                connect_addr: "127.0.0.1:43123".to_owned(),
                host_header: "127.0.0.1:43123".to_owned(),
                path: "/mcp?x=1".to_owned(),
            }
        );
        assert_eq!(
            parse_http_endpoint("http://[::1]:43123/mcp").unwrap(),
            HttpEndpoint {
                connect_addr: "[::1]:43123".to_owned(),
                host_header: "[::1]:43123".to_owned(),
                path: "/mcp".to_owned(),
            }
        );
        assert!(parse_http_endpoint("https://127.0.0.1:43123/mcp").is_err());
    }

    #[test]
    fn relays_session_tools_errors_cancellation_and_sse_over_loopback_http() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let recorded = Arc::new(Mutex::new(Vec::<(HashMap<String, String>, String)>::new()));
        let recorded_srv = Arc::clone(&recorded);
        let (slow_tx, slow_rx) = mpsc::channel::<()>();
        let slow_release = Arc::new(Mutex::new(Some(slow_rx)));

        let server = thread::spawn(move || {
            let mut workers = Vec::new();
            // Expect 8 HTTP requests: initialize, initialized, tools/list, tools/call(ok),
            // tools/call(http-500), tools/call(slow_sse), notifications/cancelled, ping.
            for _ in 0..8 {
                let (mut stream, _) = listener.accept().unwrap();
                let recorded_req = Arc::clone(&recorded_srv);
                let slow_tx_req = slow_tx.clone();
                let slow_release_req = Arc::clone(&slow_release);
                workers.push(thread::spawn(move || {
                    let (headers, body) = read_http_request(&mut stream);
                    recorded_req.lock().unwrap().push((headers, body.clone()));
                    let msg: Value = serde_json::from_str(&body).unwrap();
                    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
                    let id = msg.get("id").cloned();

                    match method {
                        "initialize" => {
                            let resp = json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "result": { "protocolVersion": "2025-06-18" }
                            })
                            .to_string();
                            let raw = format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nMcp-Session-Id: sess-99\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                                resp.len(),
                                resp
                            );
                            stream.write_all(raw.as_bytes()).unwrap();
                        }
                        "notifications/initialized" => {
                            stream
                                .write_all(b"HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                                .unwrap();
                        }
                        "tools/list" => {
                            let resp = json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "result": { "tools": [{ "name": "t3_thread_list" }, { "name": "delegate_task" }] }
                            })
                            .to_string();
                            let raw = format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                                resp.len(),
                                resp
                            );
                            stream.write_all(raw.as_bytes()).unwrap();
                        }
                        "tools/call" => {
                            let name = msg["params"]["name"].as_str().unwrap_or("");
                            match name {
                                "ok_tool" => {
                                    let resp = json!({
                                        "jsonrpc": "2.0",
                                        "id": id,
                                        "result": { "structuredContent": { "echo": msg["params"]["arguments"]["text"] } }
                                    })
                                    .to_string();
                                    let raw = format!(
                                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                                        resp.len(),
                                        resp
                                    );
                                    stream.write_all(raw.as_bytes()).unwrap();
                                }
                                "broken_http" => {
                                    stream
                                        .write_all(b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 4\r\nConnection: close\r\n\r\nfail")
                                        .unwrap();
                                }
                                "slow_sse" => {
                                    stream
                                        .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n")
                                        .unwrap();
                                    write_chunk(
                                        &mut stream,
                                        b"data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\",\"params\":{\"progress\":1}}\n\n",
                                    );
                                    if let Some(rx) = slow_release_req.lock().unwrap().take() {
                                        let _ = rx.recv_timeout(Duration::from_secs(5));
                                    }
                                    stream.write_all(b"0\r\n\r\n").unwrap();
                                    stream.flush().unwrap();
                                }
                                _ => {}
                            }
                        }
                        "notifications/cancelled" => {
                            let _ = slow_tx_req.send(());
                            stream
                                .write_all(b"HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                                .unwrap();
                        }
                        "ping" => {
                            let resp = json!({ "jsonrpc": "2.0", "id": id, "result": {} }).to_string();
                            let raw = format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                                resp.len(),
                                resp
                            );
                            stream.write_all(raw.as_bytes()).unwrap();
                        }
                        _ => {}
                    }
                }));
            }
            for w in workers {
                w.join().unwrap();
            }
        });

        let (in_tx, in_rx) = mpsc::channel::<Vec<u8>>();
        let (out_tx, out_rx) = mpsc::channel::<String>();
        let (writer, raw_out) = SharedWriter::new(Some(out_tx));
        let endpoint = format!("http://{addr}/mcp");

        let bridge = thread::spawn(move || {
            run_bridge(
                &endpoint,
                "Bearer native-test",
                ChannelReader {
                    rx: in_rx,
                    current: Vec::new(),
                    offset: 0,
                },
                writer,
            )
            .unwrap();
        });

        let send = |v: Value| {
            let mut bytes = serde_json::to_vec(&v).unwrap();
            bytes.push(b'\n');
            in_tx.send(bytes).unwrap();
        };

        send(json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18" } }));
        send(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
        // Malformed JSON line must produce -32700 without reaching HTTP server.
        in_tx.send(b"{not-json}\r\n".to_vec()).unwrap();
        send(json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }));
        // U+2028 / U+2029 and multi-byte emoji split across chunks.
        let special = serde_json::to_string(&json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": { "name": "ok_tool", "arguments": { "text": "a\u{2028}b\u{2029}\u{1F30D}" } }
        }))
        .unwrap();
        let special_bytes = special.into_bytes();
        let split = special_bytes.len() - 5;
        in_tx.send(special_bytes[..split].to_vec()).unwrap();
        let mut tail = special_bytes[split..].to_vec();
        tail.push(b'\n');
        in_tx.send(tail).unwrap();
        send(json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": "broken_http", "arguments": {} } }));
        send(json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": { "name": "slow_sse", "arguments": {} } }));

        // Wait for live SSE progress notification before sending cancellation!
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut saw_progress = false;
        while std::time::Instant::now() < deadline {
            if let Ok(line) = out_rx.recv_timeout(Duration::from_millis(200)) {
                if let Ok(val) = serde_json::from_str::<Value>(&line) {
                    if val.get("method").and_then(Value::as_str) == Some("notifications/progress") {
                        saw_progress = true;
                        break;
                    }
                }
            }
        }
        assert!(saw_progress, "expected live SSE progress before stream closed");

        send(json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": 5 } }));
        send(json!({ "jsonrpc": "2.0", "id": 6, "method": "ping", "params": {} }));
        drop(in_tx);

        bridge.join().unwrap();
        server.join().unwrap();

        let output_text = String::from_utf8(raw_out.lock().unwrap().clone()).unwrap();
        let messages: Vec<Value> = output_text
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();

        let by_id = |id: i64| messages.iter().find(|m| m.get("id") == Some(&json!(id)));
        assert_eq!(by_id(1).unwrap()["result"]["protocolVersion"], "2025-06-18");
        assert_eq!(by_id(2).unwrap()["result"]["tools"].as_array().unwrap().len(), 2);
        assert_eq!(
            by_id(3).unwrap()["result"]["structuredContent"]["echo"],
            "a\u{2028}b\u{2029}\u{1F30D}"
        );
        assert_eq!(by_id(4).unwrap()["error"]["code"], -32603);
        assert_eq!(by_id(6).unwrap()["result"], json!({}));
        assert!(messages.iter().any(|m| m["id"].is_null() && m["error"]["code"] == -32700));

        let reqs = recorded.lock().unwrap();
        assert_eq!(reqs.len(), 8);
        assert_eq!(reqs[0].0.get("authorization").map(String::as_str), Some("Bearer native-test"));
        for (hdrs, _) in reqs.iter().skip(1) {
            assert_eq!(hdrs.get("mcp-session-id").map(String::as_str), Some("sess-99"));
            assert_eq!(hdrs.get("mcp-protocol-version").map(String::as_str), Some("2025-06-18"));
        }
    }

    #[test]
    fn client_response_bypasses_session_barrier_during_elicitation() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (ack_tx, ack_rx) = mpsc::channel::<Value>();
        let ack_rx = Arc::new(Mutex::new(Some(ack_rx)));

        let server = thread::spawn(move || {
            let mut workers = Vec::new();
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                let ack_tx_req = ack_tx.clone();
                let ack_rx_req = Arc::clone(&ack_rx);
                workers.push(thread::spawn(move || {
                    let (_headers, body) = read_http_request(&mut stream);
                    let msg: Value = serde_json::from_str(&body).unwrap();
                    if msg.get("method").and_then(Value::as_str) == Some("initialize") {
                        stream
                            .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n")
                            .unwrap();
                        write_chunk(
                            &mut stream,
                            b"data: {\"jsonrpc\":\"2.0\",\"id\":\"srv-1\",\"method\":\"elicitation/create\",\"params\":{}}\n\n",
                        );
                        let reply = ack_rx_req
                            .lock()
                            .unwrap()
                            .take()
                            .unwrap()
                            .recv_timeout(Duration::from_secs(5))
                            .unwrap();
                        assert_eq!(reply["id"], "srv-1");
                        write_chunk(
                            &mut stream,
                            b"data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-06-18\"}}\n\n",
                        );
                        stream.write_all(b"0\r\n\r\n").unwrap();
                        stream.flush().unwrap();
                    } else {
                        ack_tx_req.send(msg).unwrap();
                        stream
                            .write_all(b"HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                            .unwrap();
                    }
                }));
            }
            for w in workers {
                w.join().unwrap();
            }
        });

        let (in_tx, in_rx) = mpsc::channel::<Vec<u8>>();
        let (out_tx, out_rx) = mpsc::channel::<String>();
        let (writer, raw_out) = SharedWriter::new(Some(out_tx));
        let endpoint = format!("http://{addr}/mcp");

        let bridge = thread::spawn(move || {
            run_bridge(
                &endpoint,
                "Bearer native-test",
                ChannelReader {
                    rx: in_rx,
                    current: Vec::new(),
                    offset: 0,
                },
                writer,
            )
            .unwrap();
        });

        in_tx
            .send(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\"}\n".to_vec())
            .unwrap();
        let srv_req: Value = serde_json::from_str(&out_rx.recv_timeout(Duration::from_secs(5)).unwrap()).unwrap();
        assert_eq!(srv_req["id"], "srv-1");
        // Send response while initialize (session handshake barrier!) is still open.
        in_tx
            .send(b"{\"jsonrpc\":\"2.0\",\"id\":\"srv-1\",\"result\":{\"action\":\"accept\"}}\n".to_vec())
            .unwrap();
        drop(in_tx);

        bridge.join().unwrap();
        server.join().unwrap();

        let output_text = String::from_utf8(raw_out.lock().unwrap().clone()).unwrap();
        let ids: Vec<Value> = output_text
            .lines()
            .map(|l| serde_json::from_str::<Value>(l).unwrap()["id"].clone())
            .collect();
        assert_eq!(ids, vec![json!("srv-1"), json!(1)]);
    }

    #[test]
    fn ignores_empty_lines_and_handles_unterminated_final_line() {
        let (writer, raw_out) = SharedWriter::new(None);
        run_bridge(
            "http://127.0.0.1:1/mcp",
            "Bearer test",
            Cursor::new(b"\n   \r\n{bad".to_vec()),
            writer,
        )
        .unwrap();
        let output_text = String::from_utf8(raw_out.lock().unwrap().clone()).unwrap();
        let parsed: Value = serde_json::from_str(output_text.trim()).unwrap();
        assert_eq!(parsed["error"]["code"], -32700);
    }
}
