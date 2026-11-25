// Minimal, safe markdown for assistant replies: paragraphs, bullet/numbered
// lists, pipe tables, **bold** and `code`. Renders React nodes only (no HTML injection).

const inline = (text, keyBase) => {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={`${keyBase}-${i}`}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={`${keyBase}-${i}`}>{p.slice(1, -1)}</code>;
    return p;
  });
};

const splitRow = (line) =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function Markdown({ text }) {
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      // Drop the |---|:--:| separator row.
      const body = rows.filter((r) => !(/^[\s|:-]+$/.test(r) && r.includes("-")));
      const [head, ...rest] = body.map(splitRow);
      blocks.push(
        <div className="md-table" key={blocks.length}>
          <table>
            <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `h${j}`)}</th>)}</tr></thead>
            <tbody>{rest.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `c${ri}${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^\s*([-*•]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i++].replace(/^\s*([-*•]|\d+\.)\s+/, ""));
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={blocks.length}>{items.map((t, j) => <li key={j}>{inline(t, `l${j}`)}</li>)}</List>);
      continue;
    }

    if (/^#{1,4}\s+/.test(line)) {
      blocks.push(<p key={blocks.length} className="md-h">{inline(line.replace(/^#{1,4}\s+/, ""), "h")}</p>);
      i++;
      continue;
    }

    if (line.trim()) {
      blocks.push(<p key={blocks.length}>{inline(line, `p${i}`)}</p>);
    }
    i++;
  }
  return <div className="md">{blocks}</div>;
}
