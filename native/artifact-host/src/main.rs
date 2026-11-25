#![windows_subsystem = "windows"]
use std::{env, path::PathBuf};
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
};
use wry::{WebContext, WebViewBuilder};

// Benchmark inputs point to the loopback fixture and a disposable browser profile.
fn main() {
    let url = env::var("ARTIFACT_BENCH_URL").expect("fixture URL");
    assert!(url.starts_with("http://127.0.0.1:"));
    let profile = PathBuf::from(env::var_os("ARTIFACT_BENCH_PROFILE").expect("sandbox profile"));
    let events = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("План задач")
        .with_inner_size(LogicalSize::new(800, 600))
        .build(&events).unwrap();
    let mut context = WebContext::new(Some(profile));
    let view = WebViewBuilder::new_with_web_context(&mut context)
        .with_url(&url)
        .build(&window).unwrap();
    events.run(move |event, _, flow| {
        let _keep_alive = (&view, &window);
        *flow = ControlFlow::Wait;
        if let Event::WindowEvent { event: WindowEvent::CloseRequested, .. } = event {
            *flow = ControlFlow::Exit;
        }
    });
}
