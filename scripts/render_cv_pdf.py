# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "markdown",
#     "pydantic",
# ]
# ///

"""
scripts/render_cv_pdf.py
Converts a tailored resume Markdown file into a print-ready PDF.

Name, contact bar, and accent color come from workspace/profile.json. Links are live; competency rows stay
plain comma-separated text so ATS parsers keep the delimiters. Rendering uses agent-browser (Chrome over CDP),
falling back to headless Google Chrome.
"""

import html as htmllib
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from candidate_profile import contact_items, load_profile

PROFILE = load_profile(required=False)
ACCENT = (PROFILE.resume.accent_color if PROFILE else "") or "#1d4ed8"
CHROME_PATHS = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "google-chrome", "chromium", "chromium-browser"]


def strip_front_matter(md_text: str) -> str:
    if md_text.lstrip().startswith("---"):
        parts = md_text.lstrip().split("---", 2)
        if len(parts) == 3:
            return parts[2]
    return md_text


def parse_resume_sections(md_text: str) -> dict:
    """Parses resume markdown into structured semantic blocks."""
    lines = strip_front_matter(md_text).strip().splitlines()
    name = PROFILE.candidate.name if PROFILE else ""
    title = ""
    summary = ""
    sections = []

    current_section = None
    buffer = []
    name_found = False

    for line in lines:
        stripped = line.strip()
        if line.startswith("# ") and not name_found:
            name = line[2:].strip()
            name_found = True
        elif current_section is None and ("•" in line or "·" in line or "@" in line) and "](" in line:
            continue
        elif current_section is None and not title and stripped.startswith("**") and stripped.endswith("**") and len(stripped) < 120:
            title = stripped.strip("*").strip()
        elif line.startswith("## "):
            if current_section:
                sections.append((current_section, "\n".join(buffer).strip()))
                buffer = []
            current_section = line[3:].strip()
        elif current_section is None and stripped and not stripped.startswith("---") and not stripped.startswith("#"):
            if not summary:
                summary = stripped
        else:
            buffer.append(line)

    if current_section:
        sections.append((current_section, "\n".join(buffer).strip()))

    # Summary section becomes the header summary box when it is a single paragraph
    kept = []
    for sec_title, content in sections:
        if sec_title == "Summary" and not summary and content and "\n- " not in content:
            summary = " ".join(l.strip() for l in content.splitlines() if l.strip())
            continue
        kept.append((sec_title, content))

    return {
        "name": name,
        "title": title,
        "summary": re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', summary),
        "sections": kept
    }


def format_experience_content(content: str) -> str:
    """Formats section markdown into HTML."""
    html_out = []
    blocks = content.split("### ")
    
    # Process pre-block if any
    if blocks[0].strip():
        lines = blocks[0].strip().splitlines()
        for line in lines:
            line_str = line.strip()
            if not line_str or line_str.startswith("---"):
                continue
            if line_str.startswith("- ") or line_str.startswith("• "):
                clean = line_str.replace("- ", "").replace("• ", "").strip()
                if clean.startswith("**") and ":**" in clean:
                    cat, vals = clean.split(":**", 1)
                    cat = cat.replace("**", "").strip()
                    vals = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', vals.strip())
                    html_out.append(f"<div class='comp-row'><span class='comp-label'>{cat}:</span> {vals}</div>")
                else:
                    clean_text = clean
                    clean_text = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', clean_text)
                    html_out.append(f"<div class='bullet-item'><span class='bullet'>•</span><span>{clean_text}</span></div>")
            else:
                clean_text = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', line_str)
                html_out.append(f"<div class='exp-para'>{clean_text}</div>")

    for block in blocks[1:]:
        lines = block.strip().splitlines()
        if not lines:
            continue
        
        # Header: Company | Location
        header_line = lines[0].strip().replace("**", "")
        company_part = header_line
        loc_part = ""
        if "|" in header_line:
            parts = header_line.split("|")
            company_part = parts[0].strip()
            loc_part = parts[1].strip()
        elif "," in header_line:
            company_part, loc_part = [x.strip() for x in header_line.split(",", 1)]

        # Title & Dates
        role_part = ""
        date_part = ""
        rest_start = 1
        if len(lines) > 1 and ("**" in lines[1] or "|" in lines[1]):
            t_line = lines[1].strip().replace("**", "")
            if "|" in t_line:
                t_parts = t_line.split("|")
                role_part = t_parts[0].strip()
                date_part = t_parts[1].strip()
            else:
                role_part = t_line
            rest_start = 2

        html_out.append(f"""
        <div class="exp-item">
            <div class="exp-header">
                <div>
                    <span class="exp-title">{role_part or company_part}</span>
                    <span class="exp-company">{company_part if role_part else ''}</span>
                    {f"<span class='exp-loc'>• {loc_part}</span>" if loc_part else ''}
                </div>
                <div class="exp-date">{date_part}</div>
            </div>
        """)

        for line in lines[rest_start:]:
            line_str = line.strip()
            if not line_str or line_str.startswith("---"):
                continue
            if line_str.startswith("#### "):
                subhead = line_str.replace("#### ", "").strip()
                html_out.append(f"<div class='sub-cat-title'>{subhead}</div>")
            elif line_str.startswith("*") and line_str.endswith("*"):
                html_out.append(f"<div class='exp-desc'>{line_str.strip('*')}</div>")
            elif line_str.startswith("- **") and ":**" in line_str:
                m = re.search(r'-\s*\*\*(.*?):\*\*(.*)', line_str)
                if m:
                    cat_name = m.group(1).strip()
                    cat_body = m.group(2).strip()
                    html_out.append(f"<div class='highlight-box'><span class='highlight-title'>{cat_name}:</span> {cat_body}</div>")
                else:
                    html_out.append(f"<div class='bullet-item'><span class='bullet'>•</span><span>{line_str.replace('- ', '')}</span></div>")
            elif line_str.startswith("- ") or line_str.startswith("• "):
                clean_text = line_str.replace("- ", "").replace("• ", "").strip()
                clean_text = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', clean_text)
                html_out.append(f"<div class='bullet-item'><span class='bullet'>•</span><span class='bullet-text'>{clean_text}</span></div>")
            else:
                clean_text = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', line_str)
                html_out.append(f"<div class='exp-para'>{clean_text}</div>")

        html_out.append("</div>")

    return "\n".join(html_out)


def build_contact_bar() -> str:
    if not PROFILE:
        return ""
    parts = []
    for text, href in contact_items(PROFILE.candidate):
        t = htmllib.escape(text)
        parts.append(f'<a href="{htmllib.escape(href)}" target="_blank">{t}</a>' if href else f"<span>{t}</span>")
    return '<div class="contact-bar">' + '<span class="dot">•</span>'.join(parts) + "</div>"


def build_resume_html(md_text: str) -> str:
    """Renders resume HTML with natural page flow and active hyperlinks."""
    parsed = parse_resume_sections(md_text)
    
    sections_html = []
    for title, content in parsed["sections"]:
        sec_class = "sec-title-teal"
        formatted_content = format_experience_content(content)
        
        sections_html.append(f"""
        <div class="section">
            <div class="section-title {sec_class}">{title}</div>
            <div class="section-content">
                {formatted_content}
            </div>
        </div>
        """)

    contact_html = build_contact_bar()

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  @page {{
    size: letter;
    margin: 0.38in 0.45in 0.38in 0.45in;
  }}
  * {{
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }}
  body {{
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #0a0a0a;
    background: #ffffff;
    line-height: 1.42;
    font-size: 9.2pt;
    margin: 0;
    padding: 0;
  }}
  
  /* Header Styles */
  .header {{
    margin-bottom: 12px;
  }}
  .name {{
    font-size: 26pt;
    font-weight: 800;
    letter-spacing: -0.5px;
    color: #0a0a0a;
    margin: 0;
    line-height: 1.05;
  }}
  .header-divider {{
    height: 3px;
    background-color: {ACCENT};
    width: 50px;
    margin-top: 6px;
    margin-bottom: 8px;
  }}
  .headline {{
    font-size: 10pt;
    color: #374151;
    font-weight: 700;
    margin-bottom: 8px;
  }}
  .contact-bar {{
    font-size: 8.6pt;
    color: #6b7280;
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
  }}
  .contact-bar a {{
    color: #374151;
    text-decoration: none;
    font-weight: 500;
  }}
  .contact-bar a:hover {{
    color: {ACCENT};
    text-decoration: underline;
  }}
  .dot {{
    color: {ACCENT};
    font-weight: bold;
    font-size: 7.5pt;
  }}
  .summary-box {{
    border-left: 2.5px solid {ACCENT};
    padding-left: 10px;
    color: #374151;
    font-size: 9.6pt;
    line-height: 1.5;
    margin-bottom: 14px;
  }}
  
  /* Section Styles */
  .section {{
    margin-bottom: 16px;
  }}
  .section-title {{
    font-size: 9pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 2px;
    margin-bottom: 8px;
    break-after: avoid;
    page-break-after: avoid;
  }}
  .sec-title-teal {{
    color: {ACCENT};
  }}
  .sec-title-pink {{
    color: {ACCENT};
  }}
  
  /* Experience Styles — Natural Flow without Page Gaps */
  .exp-item {{
    margin-bottom: 13px;
    break-inside: auto;
    page-break-inside: auto;
  }}
  .exp-header {{
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 2px;
    break-after: avoid;
    page-break-after: avoid;
  }}
  .exp-title {{
    font-weight: 700;
    font-size: 10.5pt;
    color: #111827;
    margin-right: 6px;
  }}
  .exp-company {{
    font-weight: 600;
    font-size: 9.5pt;
    color: #374151;
  }}
  .exp-loc {{
    font-size: 8.5pt;
    color: #6b7280;
    margin-left: 4px;
  }}
  .exp-date {{
    font-size: 8.2pt;
    font-weight: 700;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    text-align: right;
  }}
  .exp-desc {{
    font-size: 8.2pt;
    color: #4b5563;
    font-style: italic;
    margin-bottom: 4px;
    line-height: 1.35;
  }}
  .exp-para {{
    font-size: 9.3pt;
    color: #4b5563;
    margin-bottom: 4px;
    line-height: 1.45;
  }}
  
  /* Bullets */
  .bullet-item {{
    display: flex;
    margin-bottom: 4px;
    padding-left: 4px;
    font-size: 9.3pt;
    line-height: 1.45;
    color: #374151;
    break-inside: avoid;
    page-break-inside: avoid;
  }}
  .bullet {{
    width: 10px;
    color: {ACCENT};
    font-weight: bold;
    flex-shrink: 0;
  }}
  .bullet-text strong {{
    color: #111827;
    font-weight: 700;
  }}
  
  /* Highlights & Competencies */
  .highlight-box {{
    background-color: #f9fafb;
    border-left: 2px solid {ACCENT};
    padding: 3px 8px;
    margin: 3px 0 4px 4px;
    font-size: 8.3pt;
    color: #374151;
    line-height: 1.35;
    break-inside: avoid;
    page-break-inside: avoid;
  }}
  .highlight-title {{
    font-weight: 700;
    color: {ACCENT};
    text-transform: uppercase;
    font-size: 7.5pt;
    letter-spacing: 0.5px;
  }}
  .comp-row {{
    font-size: 9.2pt;
    margin-bottom: 4px;
    line-height: 1.45;
  }}
  .comp-label {{
    font-weight: 700;
    color: #111827;
  }}
  .sub-cat-title {{
    font-size: 8pt;
    font-weight: 800;
    color: {ACCENT};
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-top: 8px;
    margin-bottom: 3px;
    break-after: avoid;
    page-break-after: avoid;
  }}

  /* Footer */
  .footer {{
    margin-top: 18px;
    padding-top: 6px;
    border-top: 1px solid #e5e7eb;
    display: flex;
    justify-content: center;
    break-inside: avoid;
    page-break-inside: avoid;
  }}
</style>
</head>
<body>
  <div class="header">
    <div class="name">{parsed["name"]}</div>
    {contact_html}
    <div class="header-divider"></div>
    {f"<div class='headline'>{parsed['title']}</div>" if parsed["title"] else ""}
    {f"<div class='summary-box'>{parsed['summary']}</div>" if parsed["summary"] else ""}
  </div>

  <div class="content">
    {"".join(sections_html)}
  </div>

  <div class="footer">
    {contact_html}
  </div>
</body>
</html>
"""
    return html


def render_pdf_from_markdown(md_path: Path, output_pdf_path: Path) -> Path:
    html_content = build_resume_html(md_path.read_text(encoding="utf-8"))
    temp_html = md_path.parent / f"{md_path.stem}.tmp.html"
    temp_html.write_text(html_content, encoding="utf-8")
    try:
        if shutil.which("agent-browser"):
            cmd = f"agent-browser open 'file://{temp_html.resolve()}' && agent-browser wait 500 && agent-browser pdf '{output_pdf_path.resolve()}'"
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=45)
        else:
            chrome = next((c for c in CHROME_PATHS if Path(c).exists() or shutil.which(c)), None)
            if not chrome:
                raise RuntimeError("Neither agent-browser nor Google Chrome is installed; cannot render PDF.")
            res = subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                                  f"--print-to-pdf={output_pdf_path.resolve()}", f"file://{temp_html.resolve()}"],
                                 capture_output=True, text=True, timeout=60)
        if res.returncode != 0 or not output_pdf_path.exists():
            raise RuntimeError(f"PDF render failed: {(res.stderr or res.stdout)[-400:]}")
    finally:
        if temp_html.exists():
            temp_html.unlink()
    return output_pdf_path


def main():
    if len(sys.argv) < 2:
        print("Usage: uv run --script scripts/render_cv_pdf.py <path_to_resume.md> [output.pdf]")
        sys.exit(1)

    md_p = Path(sys.argv[1]).resolve()
    if not md_p.exists():
        print(f"File not found: {md_p}", file=sys.stderr)
        sys.exit(1)

    if len(sys.argv) >= 3:
        out_pdf = Path(sys.argv[2]).resolve()
    else:
        out_pdf = md_p.parent / f"{md_p.name.replace('.resume.md', '')}.resume.pdf"

    print(f"Rendering publication PDF from {md_p.name}...")
    pdf_path = render_pdf_from_markdown(md_p, out_pdf)
    print(f"✓ PDF successfully compiled to {pdf_path.name} ({pdf_path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
