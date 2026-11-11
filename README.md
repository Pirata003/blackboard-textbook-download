# blackboard-to-pdf

A single-file, zero-installation script that saves a Blackboard-hosted page-image textbook as a PDF, using nothing but your own logged-in browser session.

No extensions. No downloads. No installs. You paste one file into the browser console and press Enter.

## The story

My university course uses an online textbook "viewer" hosted on Blackboard. It has no download button, no print button, and the page link you get contains a **one-time hash** that dies the moment it is opened once. So the book can only be read while you are logged in, in the browser, one page at a time.

Things that did **not** work:

- **Saving the page link.** The link hash is one-time, and it only works for the account it was issued to anyway.
- **`fetch()` from the console or an extension.** The page images live on a different Blackboard host than the viewer, so the fetch is cross-origin and the response is blocked by CORS. This also silently killed every browser-extension approach.
- **Rendering pages to a canvas and exporting.** The canvas is tainted (cross-origin images), so `canvas.toDataURL()` throws "Tainted canvases may not be exported".

Things that **did** work:

- `<img>` tags happily load the same cross-origin images (they always could, that is how the viewer displays them).
- Once the images are in `<img>` tags **inside the viewer's own page**, drawing them to a canvas is no longer tainted, and the canvas can be exported.
- A hand-rolled, dependency-free PDF builder can wrap the original JPEG bytes directly with `/Filter /DCTDecode`, so pages are embedded without any re-encoding and without any library.

So the script: loads every page image into an off-DOM `<img>`, draws each one to a canvas at natural resolution, reads it back as JPEG, packs all of them into one PDF, and saves it as `<course>-<book>.pdf` in your Downloads. If the canvas export is still tainted on your setup, it falls back to saving the numbered pages as individual images, so you never walk away empty-handed.

## Usage

1. Open your textbook viewer page in Chrome (or any Chromium browser) **while logged in**.
2. Press `Ctrl+Shift+J` (opens DevTools focused on the console).
3. If Chrome warns about pasting, type `allow pasting` and press Enter, then paste.
4. Paste the entire contents of [`blackboard-to-pdf.js`](blackboard-to-pdf.js) and press Enter.
5. Wait for the progress overlay in the bottom-right corner. If Chrome asks about multiple downloads, click **Allow** (only needed for the fallback mode).

Result: `COURSE-book.pdf` in your Downloads folder, or a `COURSE-book/` folder of numbered page images if your setup forces fallback mode.

## What it does under the hood

- **Finds the book folder.** Textbook files live under `/bbcswebdav/courses/...` on your Blackboard host. The script takes the current page path and probes the page directory and up to five parent directories.
- **Finds the best rendition.** Books usually ship several image sets (`tablet`, `screen`, `print`, `mobile`, and an unnamed one) as `files/pages/<rendition>/1.jpg` and neighbors. The script probes each rendition and picks the first one that loads; `tablet` tends to be the highest resolution.
- **Counts the pages** by loading `1.<ext>`, `2.<ext>`, ... until the first failure.
- **Builds the PDF.** JPEG bytes are embedded as-is with `/Filter /DCTDecode`, one XObject per page, with a correct `xref` table. No libraries, no re-encoding, no quality loss.
- **Tries clean canvas export first** (`crossOrigin` anonymous, then `use-credentials`), **falls back to per-page downloads** if the canvas is tainted.

## Fair use

This script only uses the session you already have: the exact same images, at the exact same resolution, that your browser is already displaying. Use it only for course materials you are legitimately enrolled in and entitled to read, keep the result for personal study, and respect your institution's and publisher's terms. Do not redistribute what you save.

## Files

- [`blackboard-to-pdf.js`](blackboard-to-pdf.js) - the whole thing. Self-contained, no dependencies, MIT licensed.

## License

MIT
