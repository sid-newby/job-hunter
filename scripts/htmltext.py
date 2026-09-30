"""Shared HTML → readable text conversion for scraped job postings (Greenhouse returns escaped HTML)."""
import html
import re

_ESCAPED_TAG = re.compile(r'&lt;\s*/?\s*[a-zA-Z][^&]*&gt;')
_RAW_TAG = re.compile(r'<\s*/?\s*(p|div|li|ul|ol|br|h[1-6]|strong|em|span|b|i|a|table|tr|td)\b[^>]*>', re.IGNORECASE)
_BLOCK = re.compile(r'</?(p|div|ul|ol|table|tr|section|blockquote|header|footer)\b[^>]*>', re.IGNORECASE)


def looks_like_html(text: str) -> bool:
    return bool(text) and bool(_ESCAPED_TAG.search(text) or _RAW_TAG.search(text))


def html_to_text(text: str) -> str:
    if not text:
        return ""
    t = text
    if _ESCAPED_TAG.search(t):
        t = html.unescape(t)
    t = re.sub(r'<br\s*/?>', '\n', t, flags=re.IGNORECASE)
    t = re.sub(r'<\s*/li\s*>', '\n', t, flags=re.IGNORECASE)
    t = re.sub(r'<\s*li\b[^>]*>', '- ', t, flags=re.IGNORECASE)
    t = re.sub(r'<\s*/?h[1-6]\b[^>]*>', '\n\n', t, flags=re.IGNORECASE)
    t = _BLOCK.sub('\n', t)
    t = re.sub(r'<[^>]+>', '', t)
    t = html.unescape(t).replace('\xa0', ' ')
    t = re.sub(r'[ \t]+', ' ', t)
    t = re.sub(r' *\n *', '\n', t)
    t = re.sub(r'\n{3,}', '\n\n', t)
    t = re.sub(r'\n\n(- )', r'\n\1', t)
    return t.strip()
