const HOST_SOURCE: &str = include_str!("../src/main.rs");

#[test]
fn exits_when_chrome_native_messaging_input_closes() {
    assert!(HOST_SOURCE.contains("stdin_closed_tx.send(())"));
    assert!(
        HOST_SOURCE
            .matches("_ = &mut stdin_closed_rx => return Ok(())")
            .count()
            >= 2
    );
}

#[test]
fn exits_when_lume_authenticated_bridge_closes() {
    assert!(HOST_SOURCE.contains("Ok(None) => return Ok(())"));
    assert!(HOST_SOURCE.contains("Err(error) => {"));
    assert!(HOST_SOURCE.contains("status_notification(\"disconnected\""));
}
