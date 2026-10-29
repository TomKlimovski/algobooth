//! The main window, built here instead of from tauri.conf.json (`create: false`) so its WebKit configuration
//! can be set before the webview exists.
//!
//! macOS 26+ offers Writing Tools over any text selection in a webview, the Strudel editor included. On
//! 2026-10-30 the app aborted with "panic in a function that cannot unwind": AppKit raised an assertion in
//! `NSCampoLightweightUIController` as the Writing Tools affordance was torn down under the pointer, and the
//! Objective-C exception cannot unwind through tao's `sendEvent:` override. The booth has no use for Writing
//! Tools, so they are switched off for the webview.

use tauri::{App, WebviewWindowBuilder};

pub fn create_main_window(app: &App) -> tauri::Result<()> {
  let config = &app.config().app.windows[0];
  let builder = WebviewWindowBuilder::from_config(app.handle(), config)?;
  #[cfg(target_os = "macos")]
  let builder = builder.with_webview_configuration(macos::webview_configuration(
    objc2::MainThreadMarker::new().expect("setup runs on the main thread"),
  ));
  builder.build()?;
  Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
  use objc2::rc::Retained;
  use objc2::runtime::NSObjectProtocol;
  use objc2::{MainThreadMarker, msg_send, sel};
  use objc2_web_kit::WKWebViewConfiguration;

  /// `NSWritingToolsBehaviorNone`.
  const WRITING_TOOLS_NONE: isize = -1;

  /// A fresh configuration with Writing Tools off. The setter exists from macOS 15.1; older systems have
  /// no Writing Tools, so there it is skipped.
  pub fn webview_configuration(mtm: MainThreadMarker) -> Retained<WKWebViewConfiguration> {
    let config = unsafe { WKWebViewConfiguration::new(mtm) };
    if config.respondsToSelector(sel!(setWritingToolsBehavior:)) {
      unsafe {
        let _: () = msg_send![&config, setWritingToolsBehavior: WRITING_TOOLS_NONE];
      }
    }
    config
  }
}
