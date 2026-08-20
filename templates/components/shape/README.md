# {{name}}

| File | Purpose |
| --- | --- |
| `component.json` | Manifest: id, name, version, params, default size. |
| `document.json` | The drawing, as a document. Edit it on the canvas, not by hand. |
| `script.js` | Optional behaviour, run in a sandbox. |

The drawing is made of components from the **Meta** library, exactly the way a sheet is made
of components. A shape drawn here is a shape; a port dropped on its edge is a port of *this*
component; a label follows a parameter you declare in `component.json`.

Saving compiles the drawing into one shape with one set of ports, which is what gets placed.
