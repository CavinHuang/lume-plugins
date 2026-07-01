export type TextMatcher = string;

export type LocatorStep =
  | { kind: "css"; selector: string }
  | { kind: "role"; role: string; name?: TextMatcher; exact?: boolean }
  | { kind: "text"; text: TextMatcher; exact?: boolean }
  | { kind: "label"; text: TextMatcher; exact?: boolean }
  | { kind: "placeholder"; text: TextMatcher; exact?: boolean }
  | { kind: "testId"; testId: string }
  | { kind: "frame"; selector: string }
  | { kind: "locator"; selector: string }
  | { kind: "filter"; hasText?: TextMatcher; hasNotText?: TextMatcher }
  | { kind: "first" }
  | { kind: "last" }
  | { kind: "nth"; index: number }
  | { kind: "and"; locator: LocatorAst }
  | { kind: "or"; locator: LocatorAst };

export interface LocatorAst {
  version: 1;
  steps: LocatorStep[];
}

export function locatorAst(...steps: LocatorStep[]): LocatorAst {
  return { version: 1, steps };
}

export function appendLocator(ast: LocatorAst, step: LocatorStep): LocatorAst {
  return { version: 1, steps: [...ast.steps, step] };
}
