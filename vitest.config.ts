import { defineConfig } from "vitest/config";

// Config PRÓPRIA, e não o `vite.config.ts` do projeto, de propósito: aquele
// carrega os plugins de Cloudflare, React e Tailwind, que existem para construir
// o portal e nada têm a ver com os guards da fronteira. Puxá-los aqui faria o
// teste depender do pipeline de build do SPA — e quebrar quando ele mudasse.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
