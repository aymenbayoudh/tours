#!/usr/bin/env python3
"""Keep the GitHub Pages branch-root entry in sync with the site artifact."""

from pathlib import Path

root = Path(__file__).resolve().parents[1]
html = (root / "site" / "index.html").read_text(encoding="utf-8")
html = html.replace('href="./styles.css"', 'href="./site/styles.css"')
html = html.replace('src="./app.js', 'src="./site/app.js')
(root / "index.html").write_text(html, encoding="utf-8")
(root / ".nojekyll").touch()
print("Updated root index.html and .nojekyll")
