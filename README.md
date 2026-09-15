# 3D Image Mapper

A client-side Vite + React app for mapping uploaded images onto procedural shapes or imported STL, 3MF, and OBJ models for multicolor printing. The image is sampled onto generated geometry, quantized into a small material palette, assigned per triangle, previewed with three.js, and exported as a face-material-colored 3MF.

## Run Locally

```bash
npm install
npm run dev
```

## What It Does

- Upload PNG, JPG, or WebP images.
- Map the image around a cylinder or procedural vase, or onto a plane or arc.
- Import custom STL, 3MF, or OBJ geometry, scale it uniformly, and rotate it.
- Project onto visible surfaces from a chosen view or wrap around the vertical axis.
- Control stretch/contain/cover fit, scale, offsets, horizontal mirror, and horizontal repeat.
- Quantize to 2, 3, 4, 5, 8, or 16 colors.
- Edit the palette directly or use a manual filament palette.
- Optionally displace the outside wall by image brightness.
- Preview the result in 3D with orbit controls and view presets.
- Export a 3MF archive with `/3D/3dmodel.model`, `[Content_Types].xml`, `_rels/.rels`, material colors, and PrusaSlicer-oriented metadata.

## Image Mapping

The outer side surface uses angular coordinate `u` and height coordinate `v`. Triangle material assignment samples the mapped image at the triangle center. Inner walls, rim, and bottom use the last palette color as the inside/base material.

## Custom Models

Under **Shape > Model source**, choose **Custom STL / 3MF / OBJ** and load a model. You can also drop a model and an image into the app. Models are visible before loading an image.

- Set **Scale %** or any dimension; proportions stay locked. Rotate X/Y/Z in 90-degree steps to choose the printing orientation. The model is centered and placed on the bed.
- In **Place image from a view**, orbit the preview or use Front/Side/Top, then click **Project from view**. The placement stays fixed while the camera moves. **Move image** aligns the view to that placement and lets you drag the orange image frame; colors update on release. Resize with **Image size**, and rotate with **Image angle** under Shape.
- **Visible surfaces only** prevents projection through foreground geometry and leaves surfaces beyond a 75-degree facing angle unpainted. Turning it off projects through the whole model.
- **Wrap around vertical axis** maps angle to image X and height to image Y. Rotate the model to change its wrapping axis. Image offsets move the artwork/seam; horizontal repetition is optional.
- **Inside / unpainted** selects the base color, including transparent image areas. **Shape shading** helps inspect geometry but only affects the preview lighting, not exported colors. It is automatically used before an image is loaded.
- **Standard / Fine** controls interactive paint sampling, capped at 400,000 temporary render triangles. Refinement concentrates on the projected image and its color/footprint boundaries, spending the remaining budget on the highest-priority shared-edge splits instead of abandoning an entire pass. It preserves the original surface and watertight shared edges.
- **Color storage** defaults to **PrusaSlicer paint ? original mesh**. Each original face carries recursive `mmu_segmentation` paint data; the exported geometry keeps the original face count. Uniform paint branches are collapsed. Choose **Subdivided mesh ? legacy** to retain the previous export method.
- **Extra paint detail on export** (or **Triangulate detail on export** in legacy mode) enables **2x / 4x finer** sampling and an independent **1 million / 2 million** sampling budget. Each temporary paint region is resampled from the image, rather than inheriting a coarse face's color. Extra detail is relative to Standard/Fine and is constrained by the selected budget; higher settings do not guarantee printable detail beyond the printer's resolution.
- **Clean small color islands** uses **Max island mm?** for imported models (default 0.05 mm?). It merges small islands into larger neighboring colors by shared boundary length, without crossing the image/visibility mask. Small lettering can also be removed, so keep the threshold low. Simple shapes retain the original triangle-count cleanup setting.
- **Preview export** prepares and displays the exact refined/cleaned paint used by the next export. Changes to the image, model, palette, or export options invalidate that prepared result. Export preparation runs in a separate worker and can be cancelled; final 3MF packaging is not cancellable. The ordinary preview remains lighter. Relief remains available for simple shapes.

STL supports ASCII and binary encoding. STL/OBJ coordinates are interpreted as millimeters with Z up; use scaling and rotation to correct other conventions. 3MF import reads declared units, build/component transforms, and referenced model parts. Imported textures, paint, and slicer configuration are replaced by this project's image/palette. Multiple build items are retained together as one exported mesh; this is not a slicer-project editor. Imports are limited to 80 MB and 400,000 source triangles. Native paint exports keep that source geometry; legacy exports may contain up to 2 million geometry triangles and need simplification before reimport. Open/non-manifold geometry is reported, not automatically repaired.

The app supports one image placement at a time. Native paint keeps the model geometry small, but temporary render/sampling triangles and PrusaSlicer paint trees still consume memory. It does not provide unlimited color resolution. Very small image features may be lost at the triangle limit; cylindrical projection distorts complex appendages and end faces. Printed ColorMix appearance still depends on layer height, filament, and surface orientation.

## Validation

`npm run build` checks TypeScript and the production bundle. `scripts/custom-model-browser-tests.mjs` exercises import formats, 3MF units/assemblies, mesh refinement, occlusion, the React/worker workflow, dragging, export metadata and geometry roundtripping, partial-budget refinement, area-based cleanup, export cancellation/preview, and returning to simple shapes. It requires Vite at `http://127.0.0.1:5173` and a local Chromium browser with remote debugging on port 9223. Run it with `node scripts/custom-model-browser-tests.mjs`. If present, the repository's Benchbin and Gecko 3MF files are also tested. Screenshots go to `node_modules/.tmp/`. With the same server/browser running and the repository Benchy file present, `node scripts/benchy-detail-benchmark.mjs` compares preview/export triangle counts, processing time, and image-boundary overshoot on the actual Benchy geometry. Add `--paint --package` to verify native paint on the Benchy and save `node_modules/.tmp/benchy-native-paint.3mf`, or `--high --package` to exercise legacy 4x / 2-million-triangle export. Browser downloads are suppressed during these tests.

For native paint, run `node scripts/native-paint-browser-tests.mjs`, then `python scripts/native-paint-cli-tests.py`. The latter uses an isolated PrusaSlicer data directory and requires PrusaSlicer 2.9.6 (override the executable with `PRUSA_SLICER`). It verifies preservation of the original 12-face fixture and its exact paint strings through PrusaSlicer, then slices it and checks all five ColorMix tools are used. The browser test checks extended material states, all subdivision headers, and decoded color placement against the rendered preview.

## 3MF Compatibility

The exporter follows the sibling Color Mix Shading app's PrusaSlicer strategy, writing `slic3rpe:mmu_segmentation` triangle attributes and `Metadata/Prusa_Slicer_full_spectrum.json` with virtual material recipes. It also includes a model thumbnail. Native sub-triangle paint uses the same attribute with a recursive subdivision tree instead of a single material state. The independent encoder follows the [PrusaSlicer 2.9.6 serialization and subdivision format](https://github.com/prusa3d/PrusaSlicer/blob/version_2.9.6/src/libslic3r/TriangleSelector.cpp) and [3MF hex serialization](https://github.com/prusa3d/PrusaSlicer/blob/version_2.9.6/src/libslic3r/Model.cpp). The app renders a temporary colored surface for preview; it exports the original geometric mesh plus paint annotations. A generic texture preview alone is not the exported color representation.

3MF color compatibility depends on slicer support. Tested target: PrusaSlicer.

## Known Limitations

- No dithering; procedural shapes support triangle-count color island cleanup.
- Procedural meshes and model file parsing run on the main thread; custom projection/refinement runs in a worker.
- Vase normals are approximate.
- Filament color matching uses RGB distance.
- PrusaSlicer behavior should be tested against target versions and MMU workflows.

## Roadmap

- Multiple image placements and region selection.
- Region cleanup / island removal.
- Lab color matching.
- Real filament preset library.
- Curved plaque, lampshade, and ornament shapes.
- Better PrusaSlicer compatibility testing.
