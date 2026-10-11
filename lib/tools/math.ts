/**
 * Small expression evaluator for the calculator tool.
 *
 * Deliberately not `eval`: only numbers, + - * / % ^, parentheses, and a short
 * list of functions are accepted, so a model cannot smuggle in code.
 */

const FUNCTIONS: Record<string, (value: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  ln: Math.log,
  log10: Math.log10,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

export class ExpressionError extends Error {}

export function evaluateExpression(input: string): number {
  const source = input.replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/").toLowerCase();
  if (!source) throw new ExpressionError("The expression is empty.");
  if (source.length > 200) throw new ExpressionError("That expression is too long.");
  if (/[^0-9+\-*/%^().,a-z]/.test(source)) {
    throw new ExpressionError("Only numbers, + - * / % ^, parentheses, and a few functions are supported.");
  }

  let index = 0;
  const peek = () => source[index];

  function parseExpression(): number {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const operator = source[index++];
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parsePower();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const operator = source[index++];
      const right = parsePower();
      if (operator === "*") value *= right;
      else if (operator === "/") value /= right;
      else value %= right;
    }
    return value;
  }

  function parsePower(): number {
    const base = parseUnary();
    if (peek() === "^") {
      index += 1;
      return base ** parsePower();
    }
    return base;
  }

  function parseUnary(): number {
    if (peek() === "-") {
      index += 1;
      return -parseUnary();
    }
    if (peek() === "+") {
      index += 1;
      return parseUnary();
    }
    return parseAtom();
  }

  function parseAtom(): number {
    if (peek() === "(") {
      index += 1;
      const value = parseExpression();
      if (peek() !== ")") throw new ExpressionError("Unbalanced parentheses.");
      index += 1;
      return value;
    }

    const nameMatch = /^[a-z]+/.exec(source.slice(index));
    if (nameMatch) {
      const name = nameMatch[0];
      index += name.length;

      if (peek() === "(") {
        index += 1;
        const argument = parseExpression();
        if (peek() !== ")") throw new ExpressionError("Unbalanced parentheses.");
        index += 1;
        const fn = FUNCTIONS[name];
        if (!fn) throw new ExpressionError(`Unknown function: ${name}`);
        return fn(argument);
      }

      const constant = CONSTANTS[name];
      if (constant === undefined) throw new ExpressionError(`Unknown name: ${name}`);
      return constant;
    }

    const numberMatch = /^\d*\.?\d+/.exec(source.slice(index));
    if (!numberMatch) throw new ExpressionError(`Unexpected character at position ${index + 1}.`);
    index += numberMatch[0].length;
    return Number(numberMatch[0]);
  }

  const result = parseExpression();
  if (index !== source.length) throw new ExpressionError(`Unexpected input at position ${index + 1}.`);
  if (!Number.isFinite(result)) throw new ExpressionError("The result is not a finite number.");
  return result;
}