//! Request checks shared by the HTTP API and the extension WebSocket (cli/src/relay/origins.ts).

use std::collections::HashSet;

pub fn allowed_extension_origins() -> HashSet<String> {
    let mut origins: HashSet<String> = [crate::protocol::stable_unpacked_origin(), format!("chrome-extension://{}", crate::protocol::store_id())].into();
    if let Ok(raw) = std::env::var("OPENCODE_BROWSER_EXTENSION_ORIGINS") {
        for token in raw.split(|c: char| c == ',' || c.is_whitespace()) {
            let value = token.trim();
            let id = value.strip_prefix("chrome-extension://").unwrap_or("");
            if !id.is_empty() && id.bytes().all(|b| (b'a'..=b'p').contains(&b)) || is_firefox_origin(value) {
                origins.insert(value.to_string());
            }
        }
    }
    origins
}

fn is_firefox_origin(value: &str) -> bool {
    let Some(id) = value.strip_prefix("moz-extension://") else {
        return false;
    };
    let id = id.trim_end_matches('/');
    id.len() == 36
        && id.bytes().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
}

pub fn validate_host_header(host_header: Option<&str>, host: &str, port: u16) -> Result<(), &'static str> {
    let (hostname, header_port) = parse_host_header(host_header).ok_or("Invalid Host header")?;
    if header_port.is_some_and(|p| p != port) {
        return Err("Invalid Host header port");
    }
    let normalized = host.trim().trim_start_matches('[').trim_end_matches(']').to_lowercase();
    if ["localhost", "127.0.0.1", "::1", normalized.as_str()].contains(&hostname.as_str()) {
        Ok(())
    } else {
        Err("Invalid Host header")
    }
}

fn parse_host_header(header: Option<&str>) -> Option<(String, Option<u16>)> {
    let value = header?.trim().to_lowercase();
    if value.is_empty() {
        return None;
    }
    let port = |text: &str| text.parse::<u16>().ok().filter(|p| *p > 0 && text.bytes().all(|b| b.is_ascii_digit()));
    if let Some(rest) = value.strip_prefix('[') {
        let close = rest.find(']')?;
        let hostname = &rest[..close];
        let tail = &rest[close + 1..];
        if hostname.is_empty() {
            return None;
        }
        if tail.is_empty() {
            return Some((hostname.to_string(), None));
        }
        return Some((hostname.to_string(), Some(port(tail.strip_prefix(':')?)?)));
    }
    if value == "::1" {
        return Some(("::1".into(), None));
    }
    match value.matches(':').count() {
        0 => Some((value, None)),
        1 => {
            let (hostname, text) = value.split_once(':')?;
            if hostname.is_empty() {
                return None;
            }
            Some((hostname.to_string(), Some(port(text)?)))
        }
        _ => None,
    }
}

pub fn validate_fetch_site(value: Option<&str>) -> Result<(), &'static str> {
    match value {
        None | Some("") | Some("same-origin") | Some("none") => Ok(()),
        _ => Err("Cross-origin browser requests are not allowed"),
    }
}

pub fn validate_extension_origin(origin: Option<&str>, allowed: &HashSet<String>) -> Result<(), &'static str> {
    match origin {
        None => Err("Extension WebSocket origin is required"),
        Some(origin) if allowed.contains(origin) || is_firefox_origin(origin) => Ok(()),
        Some(_) => Err("Extension WebSocket origin is not allowed"),
    }
}

pub fn is_local_peer(address: &std::net::SocketAddr) -> bool {
    match address.ip() {
        std::net::IpAddr::V4(ip) => ip.is_loopback(),
        std::net::IpAddr::V6(ip) => ip.is_loopback() || ip.to_ipv4_mapped().is_some_and(|v4| v4.is_loopback()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_headers() {
        assert!(validate_host_header(Some("127.0.0.1:19988"), "127.0.0.1", 19988).is_ok());
        assert!(validate_host_header(Some("localhost"), "127.0.0.1", 19988).is_ok());
        assert!(validate_host_header(Some("[::1]:19988"), "127.0.0.1", 19988).is_ok());
        assert!(validate_host_header(Some("evil.com:19988"), "127.0.0.1", 19988).is_err());
        assert!(validate_host_header(Some("127.0.0.1:1"), "127.0.0.1", 19988).is_err());
        assert!(validate_host_header(None, "127.0.0.1", 19988).is_err());
    }

    #[test]
    fn extension_origins() {
        let allowed = allowed_extension_origins();
        assert!(validate_extension_origin(Some(&crate::protocol::stable_unpacked_origin()), &allowed).is_ok());
        assert!(validate_extension_origin(Some("https://example.com"), &allowed).is_err());
        assert!(validate_extension_origin(None, &allowed).is_err());
    }

    #[test]
    fn firefox_origins() {
        let allowed = allowed_extension_origins();
        let origin = "moz-extension://0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";
        assert!(validate_extension_origin(Some(origin), &allowed).is_ok());
        assert!(validate_extension_origin(Some(&format!("{origin}/")), &allowed).is_ok());
        assert!(validate_extension_origin(Some("moz-extension://not-a-uuid"), &allowed).is_err());
        assert!(validate_extension_origin(Some("moz-extension://0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5z"), &allowed).is_err());
        assert!(validate_extension_origin(Some("https://0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"), &allowed).is_err());
    }
}
