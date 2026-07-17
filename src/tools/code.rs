use crate::tools::registry::ToolResult;

pub struct CodeTool;

impl CodeTool {
    pub fn new() -> Self {
        Self
    }

    pub fn execute(&self, operation: &str, code: &str, _language: &str) -> ToolResult {
        // A minimal implementation of code analysis.
        // For Phase 2, we just return a simple AST or token count stub.
        // In reality, this would hook into tree-sitter or syn for real analysis.
        
        match operation {
            "parse" => {
                let lines = code.lines().count();
                let chars = code.chars().count();
                let funcs = code.lines().filter(|l| l.contains("fn ") || l.contains("function ") || l.contains("def ")).count();
                
                ToolResult {
                    success: true,
                    output: format!("Lines: {}\nCharacters: {}\nFunctions/Methods detected: {}", lines, chars, funcs),
                    error: None,
                }
            }
            "lint" => {
                if code.trim().is_empty() {
                    return ToolResult { success: false, output: String::new(), error: Some("Code is empty".to_string()) };
                }
                
                // Basic bracket matching
                let mut open_brackets = 0;
                let mut open_braces = 0;
                let mut open_parens = 0;
                
                for c in code.chars() {
                    match c {
                        '[' => open_brackets += 1,
                        ']' => open_brackets -= 1,
                        '{' => open_braces += 1,
                        '}' => open_braces -= 1,
                        '(' => open_parens += 1,
                        ')' => open_parens -= 1,
                        _ => {}
                    }
                }
                
                let mut issues = Vec::new();
                if open_brackets != 0 { issues.push(format!("Mismatched square brackets: {}", open_brackets)); }
                if open_braces != 0 { issues.push(format!("Mismatched curly braces: {}", open_braces)); }
                if open_parens != 0 { issues.push(format!("Mismatched parentheses: {}", open_parens)); }
                
                if issues.is_empty() {
                    ToolResult { success: true, output: "No syntax errors found.".to_string(), error: None }
                } else {
                    ToolResult { success: false, output: issues.join("\n"), error: Some("Linting found issues".to_string()) }
                }
            }
            "format" => {
                ToolResult { success: true, output: code.to_string(), error: None } // no-op for now
            }
            _ => {
                ToolResult { success: false, output: String::new(), error: Some(format!("Unknown operation: {}", operation)) }
            }
        }
    }
}
