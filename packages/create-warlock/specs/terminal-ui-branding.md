# Terminal UI & Branding

**Purpose**: Create a premium, memorable developer experience with beautiful terminal visuals.

## Overview

The CLI should feel polished and "show off" Warlock.js branding. Key moments for visual impact:

1. **Intro Banner** - ASCII art logo when wizard starts
2. **Progress Spinners** - Animated feedback during operations
3. **Success Screen** - Celebratory completion with next steps

## 1. Intro Banner

Display an ASCII art Warlock logo with version and tagline:

```
   ╦ ╦╔═╗╦═╗╦  ╔═╗╔═╗╦╔═  ╦╔═╗
   ║║║╠═╣╠╦╝║  ║ ║║  ╠╩╗  ║╚═╗
   ╚╩╝╩ ╩╩╚═╩═╝╚═╝╚═╝╩ ╩o╚╝╚═╝

   ⚡ The Magical Node.js Framework ⚡

   v4.0.0
```

**Alternative simpler version:**

```
  ╭──────────────────────────────────────╮
  │                                      │
  │   🧙 WARLOCK.JS                      │
  │   The Magical Node.js Framework      │
  │                                      │
  │   v4.0.0                             │
  │                                      │
  ╰──────────────────────────────────────╯
```

**Implementation:**

```typescript
import { intro } from "@clack/prompts";
import { colors } from "@mongez/copper";

const banner = `
  ${colors.magentaBright("╭──────────────────────────────────────╮")}
  ${colors.magentaBright("│")}                                      ${colors.magentaBright("│")}
  ${colors.magentaBright("│")}   🧙 ${colors.bold(colors.yellowBright("WARLOCK.JS"))}                      ${colors.magentaBright("│")}
  ${colors.magentaBright("│")}   ${colors.cyan("The Magical Node.js Framework")}      ${colors.magentaBright("│")}
  ${colors.magentaBright("│")}                                      ${colors.magentaBright("│")}
  ${colors.magentaBright("│")}   ${colors.green("v" + version)}                             ${colors.magentaBright("│")}
  ${colors.magentaBright("│")}                                      ${colors.magentaBright("│")}
  ${colors.magentaBright("╰──────────────────────────────────────╯")}
`;

console.log(banner);
intro(colors.cyan("✨ Let's create something magical! ✨"));
```

## 2. Progress Spinners

Use themed spinner messages with emojis:

| Step            | Spinner Message                   |
| --------------- | --------------------------------- |
| Installing deps | 📦 Summoning dependencies...      |
| Git init        | 📂 Initializing git repository... |
| JWT generation  | 🔐 Forging secret keys...         |
| Warm cache      | ⚡ Charging magical circuits...   |
| Config setup    | 🔧 Configuring enchantments...    |

## 3. Success Screen

Show a celebratory completion banner:

```
  ╭──────────────────────────────────────────────────╮
  │                                                  │
  │   🎉 YOUR PROJECT IS READY TO ROCK! 🎉          │
  │                                                  │
  │   Project: my-awesome-app                        │
  │   Database: PostgreSQL                           │
  │   Features: react, mail, herald                  │
  │                                                  │
  ╰──────────────────────────────────────────────────╯

  🚀 Next steps:

     cd my-awesome-app
     yarn dev

  💡 Pro tip: Install the Generator Z extension in VSCode
     for helpful code snippets and productivity boosters!

  📚 Docs: https://warlock.js.org
  ⭐ Star us: https://github.com/warlock-js/warlock
```

## 4. Color Palette

Use consistent colors throughout:

| Element       | Color                       |
| ------------- | --------------------------- |
| Brand/Logo    | `magentaBright`             |
| Headings      | `yellowBright` + `bold`     |
| Info/Taglines | `cyan`                      |
| Success       | `green`                     |
| Commands      | `cyan` (in gray background) |
| Warnings      | `yellow`                    |
| Errors        | `red`                       |

## 5. Optional: Loading Animation

For the installation step, could show a fun themed message rotation:

```typescript
const loadingMessages = [
  "📦 Summoning dependencies...",
  "🧙 Casting npm spells...",
  "⚡ Channeling node modules...",
  "🔮 Reading package manifests...",
  "✨ Almost there...",
];
```

## Implementation Notes

- Use `@mongez/copper` for colors (already a dependency)
- Use `@clack/prompts` for spinners and prompts
- Keep ASCII art simple to work across different terminals
- Test on Windows Terminal, iTerm2, and basic terminals

## Tasks

- [ ] Create banner display function with ASCII art
- [ ] Add themed spinner messages
- [ ] Create success screen with project summary
- [ ] Apply consistent color palette throughout
- [ ] Test terminal compatibility (Windows, macOS, Linux)
