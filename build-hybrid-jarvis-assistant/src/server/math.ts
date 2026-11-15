// Safe arithmetic evaluator (recursive descent) + natural-language normalisation.
// Never uses eval/Function.

type Tok =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  sin: (x) => Math.sin((x * Math.PI) / 180),
  cos: (x) => Math.cos((x * Math.PI) / 180),
  tan: (x) => Math.tan((x * Math.PI) / 180),
  asin: (x) => (Math.asin(x) * 180) / Math.PI,
  acos: (x) => (Math.acos(x) * 180) / Math.PI,
  atan: (x) => (Math.atan(x) * 180) / Math.PI,
  log: Math.log10,
  log2: Math.log2,
  ln: Math.log,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  exp: Math.exp,
  fact: (x) => factorial(x),
};

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 170) return NaN;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) throw new Error("bad number");
      out.push({ t: "num", v: n });
      i = j;
    } else if (/[a-z]/i.test(c)) {
      let j = i;
      while (j < src.length && /[a-z0-9]/i.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j).toLowerCase() });
      i = j;
    } else if (c === "*" && src[i + 1] === "*") {
      out.push({ t: "op", v: "^" });
      i += 2;
    } else if ("+-*/^()%!,".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
    } else {
      throw new Error(`unexpected ${c}`);
    }
  }
  return out;
}

class Parser {
  private p = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.p];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === "op" && t.v === v;
  }
  private isId(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === "id" && t.v === v;
  }

  parse(): number {
    const v = this.expr();
    if (this.p < this.toks.length) throw new Error("trailing input");
    return v;
  }

  private expr(): number {
    let v = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.toks[this.p++] as { v: string }).v;
      const r = this.term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  private term(): number {
    let v = this.unary();
    for (;;) {
      if (this.isOp("*")) {
        this.p++;
        v *= this.unary();
      } else if (this.isOp("/")) {
        this.p++;
        v /= this.unary();
      } else if (this.isId("mod")) {
        this.p++;
        v %= this.unary();
      } else if (this.startsOperand()) {
        // implicit multiplication: 2(3+4), 2pi
        v *= this.unary();
      } else break;
    }
    return v;
  }

  private startsOperand(): boolean {
    const t = this.peek();
    if (!t) return false;
    if (t.t === "num") return true;
    if (t.t === "id") return t.v !== "mod";
    return t.t === "op" && t.v === "(";
  }

  private unary(): number {
    if (this.isOp("-")) {
      this.p++;
      return -this.unary();
    }
    if (this.isOp("+")) {
      this.p++;
      return this.unary();
    }
    return this.power();
  }

  private power(): number {
    const base = this.postfix();
    if (this.isOp("^")) {
      this.p++;
      return Math.pow(base, this.unary());
    }
    return base;
  }

  private postfix(): number {
    let v = this.primary();
    for (;;) {
      if (this.isOp("%")) {
        this.p++;
        v /= 100;
      } else if (this.isOp("!")) {
        this.p++;
        v = factorial(v);
      } else break;
    }
    return v;
  }

  private primary(): number {
    const t = this.toks[this.p++];
    if (!t) throw new Error("unexpected end");
    if (t.t === "num") return t.v;
    if (t.t === "op" && t.v === "(") {
      const v = this.expr();
      if (!this.isOp(")")) throw new Error("missing )");
      this.p++;
      return v;
    }
    if (t.t === "id") {
      if (t.v in CONSTS) return CONSTS[t.v];
      const fn = FUNCS[t.v];
      if (!fn) throw new Error(`unknown identifier ${t.v}`);
      if (this.isOp("(")) {
        this.p++;
        const arg = this.expr();
        if (!this.isOp(")")) throw new Error("missing )");
        this.p++;
        return fn(arg);
      }
      return fn(this.unary());
    }
    throw new Error("unexpected token");
  }
}

export function evaluate(expr: string): number | null {
  if (expr.length > 200) return null;
  try {
    const v = new Parser(tokenize(expr)).parse();
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Turn "what is 15% of 80 plus 4 squared" into something the parser understands. */
export function normalizeMath(input: string): string {
  let s = input.toLowerCase();
  s = s.replace(/(\d),(?=\d{3}\b)/g, "$1");
  s = s.replace(/\$/g, "");
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*of\s*/g, "($1/100)*");
  s = s.replace(/(square|cube)\s+root\s+of\s*/g, (_m, k: string) => (k === "square" ? "sqrt " : "cbrt "));
  s = s.replace(/\b(sqrt|cbrt|log|ln|abs|sin|cos|tan)\s+of\s*/g, "$1 ");
  s = s.replace(/\bto the power of\b|\braised to( the power of)?\b|\bto the\b(?=\s*\d)/g, "^");
  s = s.replace(/\bsquared\b/g, "^2").replace(/\bcubed\b/g, "^3");
  s = s.replace(/\bmultiplied by\b|\btimes\b/g, "*");
  s = s.replace(/(\d)\s*x\s*(?=[\d(])/g, "$1*");
  s = s.replace(/\bdivided by\b|\bover\b/g, "/");
  s = s.replace(/\bplus\b|\band\b(?=\s*\d)/g, "+");
  s = s.replace(/\bminus\b|\bless\b/g, "-");
  s = s.replace(/\bmodulo\b/g, "mod");
  s = s.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  return s.replace(/\s+/g, " ").trim();
}

export function tryMath(raw: string): { expr: string; value: number } | null {
  const stripped = raw
    .toLowerCase()
    .replace(
      /^(?:what(?:'s| is| are)?|whats|calculate|compute|calc|solve|evaluate|how much is|how many is|work out|figure out|tell me)\s+/,
      "",
    )
    .replace(/[?=\s]+$/g, "")
    .trim();
  if (!stripped) return null;
  const norm = normalizeMath(stripped);
  if (!/\d/.test(norm)) return null;
  if (!/[+\-*/^%!()]|\bmod\b|\b(?:sqrt|cbrt|sin|cos|tan|log2?|ln|abs|exp|round|floor|ceil|fact)\b/.test(norm)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(norm)) return null;
  const value = evaluate(norm);
  if (value === null) return null;
  return { expr: stripped, value };
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n !== 0 && (Math.abs(n) >= 1e15 || Math.abs(n) < 1e-7)) return n.toExponential(6).replace(/\.?0+e/, "e");
  const rounded = Number(n.toPrecision(12));
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 10 });
}
