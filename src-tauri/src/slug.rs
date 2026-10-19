/// A safe file name stem for a pattern name: lowercase, spaces and `/ : \` become `-`,
/// only `[a-z0-9._-]` is kept, leading dots and repeated dashes are removed,
/// at most 80 characters, and `untitled` when nothing is left.
pub fn slugify(name: &str) -> String {
  let mut out = String::new();
  for c in name.chars().flat_map(char::to_lowercase) {
    let c = if matches!(c, ' ' | '/' | ':' | '\\') { '-' } else { c };
    if !(c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-')) {
      continue;
    }
    if c == '-' && out.ends_with('-') {
      continue;
    }
    out.push(c);
  }
  let trimmed = out.trim_start_matches(['.', '-']);
  let capped = &trimmed[..trimmed.len().min(80)];
  let slug = capped.trim_end_matches('-');
  if slug.is_empty() { "untitled".into() } else { slug.into() }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn slug_handles_dj_names() {
    assert_eq!(slugify("around the world 1:12"), "around-the-world-1-12");
    assert_eq!(slugify("../evil/name"), "evil-name");
    assert_eq!(slugify(""), "untitled");
  }

  #[test]
  fn slug_strips_unsafe_characters_and_caps_length() {
    assert_eq!(slugify(".hidden"), "hidden");
    assert_eq!(slugify("Back\\slash  --  Dash"), "back-slash-dash");
    assert_eq!(slugify("Café?!*"), "caf");
    assert_eq!(slugify("..."), "untitled");
    assert_eq!(slugify(&"a".repeat(200)).len(), 80);
  }
}
