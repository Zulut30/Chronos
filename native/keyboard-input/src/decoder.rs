use std::collections::HashSet;

#[derive(Default)]
pub struct Decoder {
    held: HashSet<String>,
    consumer: u16,
}

fn word(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

impl Decoder {
    fn edge(&mut self, code: String, released: bool, out: &mut Vec<String>) {
        if released {
            self.held.remove(&code);
        } else if self.held.insert(code.clone()) {
            out.push(code);
        }
    }

    // The owner attaches the collection identity. Only distinct presses and relative steps
    // reach the command dispatcher. Release and typematic packets only update local state.
    pub fn decode(&mut self, kind: u32, consumer_collection: bool, data: &[u8]) -> Vec<String> {
        let mut out = Vec::new();
        match kind {
            1 if data.len() >= 16 => {
                let (scan, flags, vk) = (word(data, 0), word(data, 2), word(data, 6));
                if vk != 255 {
                    self.edge(
                        format!("key-{scan:x}-{:x}-{vk:x}", flags & 6),
                        flags & 1 != 0,
                        &mut out,
                    );
                }
            }
            0 if data.len() >= 24 => {
                let flags = word(data, 4);
                let delta = word(data, 6) as i16;
                for (flag, axis) in [(0x400, "wheel"), (0x800, "hwheel")] {
                    if flags & flag != 0 && delta != 0 {
                        let direction = if delta > 0 { "up" } else { "down" };
                        out.extend(std::iter::repeat_n(
                            format!("{axis}-{direction}"),
                            (delta.unsigned_abs() / 120).clamp(1, 32) as usize,
                        ));
                    }
                }
                for i in 0..5 {
                    if flags & (3 << (i * 2)) != 0 {
                        self.edge(format!("button-{i}"), flags & (2 << (i * 2)) != 0, &mut out);
                    }
                }
            }
            2 if consumer_collection && data.len() >= 8 => {
                let size = u32::from_le_bytes(data[..4].try_into().unwrap());
                let count = u32::from_le_bytes(data[4..8].try_into().unwrap()) as usize;
                // SIDE-KEYBOARD descriptor: report ID 3, one 16-bit Consumer usage.
                if size == 3 && count <= (data.len() - 8) / 3 {
                    for report in data[8..].chunks_exact(3).take(count).filter(|r| r[0] == 3) {
                        let usage = word(report, 1);
                        if usage != 0 && usage != self.consumer {
                            out.push(format!("consumer-{usage:x}"));
                        }
                        self.consumer = usage;
                    }
                }
            }
            _ => {}
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prototype_keyboard_and_mouse_buffers() {
        let mut d = Decoder::default();
        for (scan, vk) in [(63, 116), (30, 65)] {
            let mut k = [0; 16];
            k[0] = scan;
            k[6] = vk;
            assert_eq!(d.decode(1, false, &k), [format!("key-{scan:x}-0-{vk:x}")]);
            assert!(d.decode(1, false, &k).is_empty());
            k[2] = 1;
            assert!(d.decode(1, false, &k).is_empty());
            k[2] = 0;
            assert_eq!(d.decode(1, false, &k).len(), 1);
        }
        for (delta, expected) in [(-120i16, "wheel-down"), (120, "wheel-up")] {
            let mut m = [0; 24];
            m[5] = 4;
            m[6..8].copy_from_slice(&delta.to_le_bytes());
            assert_eq!(d.decode(0, false, &m), [expected]);
        }
    }
    #[test]
    fn prototype_consumer_batches_repeats_release_and_vendor() {
        let mut d = Decoder::default();
        for usage in [0xe9, 0xea, 0xe2] {
            let mut packet = [3, 0, 0, 0, 1, 0, 0, 0, 3, usage, 0];
            assert_eq!(d.decode(2, true, &packet), [format!("consumer-{usage:x}")]);
            assert!(d.decode(2, true, &packet).is_empty());
            packet[9] = 0;
            assert!(d.decode(2, true, &packet).is_empty());
        }
        assert_eq!(
            d.decode(2, true, &[3, 0, 0, 0, 2, 0, 0, 0, 3, 233, 0, 3, 0, 0]),
            ["consumer-e9"]
        );
        assert!(d
            .decode(2, true, &[3, 0, 0, 0, 2, 0, 0, 0, 3, 233, 0])
            .is_empty());
        assert!(d.decode(2, false, &[0; 73]).is_empty());
    }
}
