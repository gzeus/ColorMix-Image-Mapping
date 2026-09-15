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
- **Standard / Fine** controls interactive preview detail, capped at 400,000 triangles. Refinement concentrates on the projected image and its color/footprint boundaries, spending the remaining budget on the highest-priority shared-edge splits instead of abandoning an entire pass. It preserves the original surface and watertight shared edges.
- **Triangulate detail on export** enables **2x / 4x finer** sampling and an independent **1 million / 2 million** triangle budget. Each refined triangle is resampled from the image, rather than inheriting a coarse face's color. Extra detail is relative to Standard/Fine and is constrained by the selected budget; higher settings do not guarantee printable detail beyond the printer's resolution.
- **Clean small color islands** uses **Max island mm?** for imported models (default 0.05 mm?). It merges small islands into larger neighboring colors by shared boundary length, without crossing the image/visibility mask. Small lettering can also be removed, so keep the threshold low. Simple shapes retain the original triangle-count cleanup setting.
- **Preview export** prepares and displays the exact refined/cleaned mesh used by the next export. Changes to the image, model, palette, or export options invalidate that prepared result. Export preparation runs in a separate worker and can be cancelled; final 3MF packaging is not cancellable. The ordinary preview remains lighter. Relief remains available for simple shapes.

STL supports ASCII and binary encoding. STL/OBJ coordinates are interpreted as millimeters with Z up; use scaling and rotation to correct other conventions. 3MF import reads declared units, build/component transforms, and referenced model parts. Imported textures, paint, and slicer configuration are replaced by this project's image/palette. Multiple build items are retained together as one exported mesh; this is not a slicer-project editor. Imports are limited to 80 MB and 400,000 source triangles; exports may contain up to 2 million triangles. Large exported meshes may therefore need simplification before reimport. Open/non-manifold geometry is reported, not automatically repaired.

The first version supports one image placement at a time. Very small image features may be lost at the triangle limit; cylindrical projection distorts complex appendages and end faces. Printed ColorMix appearance still depends on layer height, filament, and surface orientation.

## Validation

`npm run build` checks TypeScript and the production bundle. `scripts/custom-model-browser-tests.mjs` exercises import formats, 3MF units/assemblies, mesh refinement, occlusion, the React/worker workflow, dragging, export metadata and geometry roundtripping, partial-budget refinement, area-based cleanup, export cancellation/preview, and returning to simple shapes. It requires Vite at `http://127.0.0.1:5173` and a local Chromium browser with remote debugging on port 9223. Run it with `node scripts/custom-model-browser-tests.mjs`. If present, the repository's Benchbin and Gecko 3MF files are also tested. Screenshots go to `node_modules/.tmp/`. With the same server/browser running and the repository Benchy file present, `node scripts/benchy-detail-benchmark.mjs` compares preview/export triangle counts, processing time, and image-boundary overshoot on the actual Benchy geometry. Add `--high --package` to exercise the 4x / 2-million-triangle setting through 3MF file creation (browser downloads are suppressed during this test).

## 3MF Compatibility

The exporter follows the sibling Color Mix Shading app's PrusaSlicer strategy, writing `slic3rpe:mmu_segmentation` triangle attributes and `Metadata/Prusa_Slicer_full_spectrum.json` with virtual material recipes. It also includes a model thumbnail. A generic texture preview alone is not the exported color representation.

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
