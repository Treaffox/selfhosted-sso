/**
 * Checks the English dictionary against the source: every German text that is passed to t()/tn()/te()/N_() (or is a
 * message of an API response / validation rule) needs an entry in src/lib/i18n/en, and every entry should still
 * be used. Run from sso-app/:  npm run i18n:check   (CI runs it too)
 */
import * as fs from "fs";
import * as path from "path";
import ts from "typescript";
import { en } from "../src/lib/i18n/en";

const SRC = path.join(__dirname, "../src");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

const used = new Map<string, string>(); // key → first file
const dynamic: string[] = [];
const MESSAGE_FILES = /(validation|site-settings|security-settings|mail\/settings|mail\/index|brand-assets|cloudflare|safe-redirect|reauth|login-flow)\.ts$|app\/api\/|app\/oauth\//;
const ZOD_CALLS = new Set(["min", "max", "email", "regex", "refine", "int", "url", "positive", "length", "superRefine"]);

const literal = (n: ts.Node | undefined): string | null => {
  if (!n) return null;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) {
    // `Ungültiger Level: ${level}` → "Ungültiger Level: {level}"
    let out = n.head.text;
    for (const span of n.templateSpans) {
      const e = span.expression;
      const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : "value";
      out += `{${name}}${span.literal.text}`;
    }
    return out;
  }
  return null;
};

for (const file of walk(SRC)) {
  if (file.includes("lib/i18n/")) continue;
  const rel = path.relative(SRC, file);
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const add = (key: string | null) => {
    if (key && /[A-Za-zÄÖÜäöüß]{2,}/.test(key) && !used.has(key)) used.set(key, rel);
  };
  (function visit(n: ts.Node) {
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf);
      if (["t", "tn", "N_"].includes(callee)) {
        const key = literal(n.arguments[0]);
        if (key === null) dynamic.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${n.getText(sf).slice(0, 60)}`);
        else add(key);
      } else if (callee === "te") {
        add(literal(n.arguments[1]));
      } else if (MESSAGE_FILES.test(rel) && ts.isPropertyAccessExpression(n.expression) && ZOD_CALLS.has(n.expression.name.text)) {
        for (const a of n.arguments) add(literal(a));
      }
    }
    if (MESSAGE_FILES.test(rel) && ts.isPropertyAssignment(n) && ["error", "error_description", "message"].includes(n.name.getText(sf))) {
      add(literal(n.initializer));
    }
    ts.forEachChild(n, visit);
  })(sf);
}

const missing = [...used].filter(([k]) => !(k in en));
const unused = Object.keys(en).filter((k) => !used.has(k));
if (dynamic.length) console.log(`Dynamic t() calls (not checked):\n  ${dynamic.join("\n  ")}\n`);
if (missing.length) console.log(`Missing English texts (${missing.length}):\n` + missing.map(([k, f]) => `  [${f}] ${JSON.stringify(k)}`).join("\n") + "\n");
if (process.argv.includes("--unused") && unused.length) console.log(`Unused entries (${unused.length}):\n` + unused.map((k) => `  ${JSON.stringify(k)}`).join("\n") + "\n");
console.log(`${used.size} texts in use, ${Object.keys(en).length} translated, ${missing.length} missing.`);
process.exit(missing.length ? 1 : 0);
