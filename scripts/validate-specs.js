const fs = require("fs");
const path = require("path");

const specsDir = path.join(__dirname, "../docs/superpowers/specs");

function validateFile(filePath) {
    const content = fs.readFileSync(filePath, "utf-8");

    if (!content.startsWith("---")) {
        console.log(`❌ Missing frontmatter: ${filePath}`);
        return false;
    }

    if (!content.includes("## Overview") && !content.includes("## Purpose")) {
        console.log(`❌ Missing Overview or Purpose: ${filePath}`);
        return false;
    }

    return true;
}

function walk(dir) {
    const files = fs.readdirSync(dir);

    files.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            walk(fullPath);
        } else if (file.endsWith(".md")) {
            validateFile(fullPath);
        }
    });
}

walk(specsDir);
