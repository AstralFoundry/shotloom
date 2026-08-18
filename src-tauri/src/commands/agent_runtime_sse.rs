use serde_json::Value;

pub(crate) fn take_sse_frame(buffer: &mut Vec<u8>) -> Option<Vec<u8>> {
    let delimiter = buffer
        .windows(2)
        .position(|window| window == b"\n\n")
        .map(|index| (index, 2))
        .or_else(|| {
            buffer
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .map(|index| (index, 4))
        })?;
    let frame = buffer[..delimiter.0].to_vec();
    buffer.drain(..delimiter.0 + delimiter.1);
    Some(frame)
}

pub(crate) fn parse_sse_data(frame: &[u8]) -> Option<Value> {
    let text = std::str::from_utf8(frame).ok()?;
    let data = text
        .lines()
        .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
        .collect::<Vec<_>>()
        .join("\n");
    if data.is_empty() {
        return None;
    }
    serde_json::from_str(&data).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lf_and_crlf_frames() {
        let mut buffer = b"data: {\"ok\":true}\n\ndata: {\"next\":1}\r\n\r\n".to_vec();
        let first = take_sse_frame(&mut buffer).expect("first frame");
        assert_eq!(parse_sse_data(&first).and_then(|value| value["ok"].as_bool()), Some(true));
        let second = take_sse_frame(&mut buffer).expect("second frame");
        assert_eq!(parse_sse_data(&second).and_then(|value| value["next"].as_i64()), Some(1));
    }
}
