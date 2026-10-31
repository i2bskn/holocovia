/** @jsxImportSource hono/jsx */
import { html } from "hono/html";
import type { Child } from "hono/jsx";
import {
  HORIZONTAL_VIEW_BOX,
  SYMBOL_BRIDGE,
  SYMBOL_BRIDGE_WIDTH,
  SYMBOL_POST_WIDTH,
  SYMBOL_POSTS,
  WORDMARK_PATHS,
  WORDMARK_TRANSFORM,
} from "../brand";

// The screens served by the Worker (login, setup, consent). They are styled by /server-pages.css, a static
// asset (client/public), because the SPA's stylesheet has a hashed name.
export function Layout(props: { title: string; children?: Child }) {
  return html`<!DOCTYPE html>${(
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#f4f5f2" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#121617" media="(prefers-color-scheme: dark)" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="stylesheet" href="/server-pages.css" />
        <title>{`${props.title} - libreno`}</title>
      </head>
      <body>
        <div class="shell">
          <a href="/" class="brand" aria-label="libreno">
            <svg class="brand-horizontal" viewBox={HORIZONTAL_VIEW_BOX} aria-hidden="true" focusable="false">
              <g
                class="brand-symbol"
                fill="none"
                stroke="currentColor"
                stroke-width={SYMBOL_POST_WIDTH}
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d={SYMBOL_POSTS} />
                <path d={SYMBOL_BRIDGE} stroke-width={SYMBOL_BRIDGE_WIDTH} />
              </g>
              <g class="brand-wordmark" transform={WORDMARK_TRANSFORM} fill="currentColor">
                {WORDMARK_PATHS.map((d) => (
                  <path d={d} />
                ))}
              </g>
            </svg>
          </a>
          <p class="tagline">チームの情報を、AIと一緒に育てる場所。</p>
          <main class="card">{props.children}</main>
        </div>
      </body>
    </html>
  )}`;
}
