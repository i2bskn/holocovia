/** @jsxImportSource hono/jsx */
import { html } from "hono/html";
import type { Child } from "hono/jsx";

export function Layout(props: { title: string; children?: Child }) {
  return html`<!DOCTYPE html>${(
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${props.title} - holocovia`}</title>
      </head>
      <body>
        <main>{props.children}</main>
      </body>
    </html>
  )}`;
}
