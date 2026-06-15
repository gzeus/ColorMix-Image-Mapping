# 3D Image Mapper

A client-side Vite + React app for turning uploaded images into multicolor, 3D-printable cylinders or simple vase shapes. The image is sampled onto generated geometry, quantized into a small material palette, assigned per triangle, previewed with three.js, and exported as a face-material-colored 3MF.

## Run Locally

```bash
npm install
npm run dev
```

## What It Does

- Upload PNG, JPG, or WebP images.
- Map the image around a cylinder or procedural vase.
- Control stretch/contain/cover fit, scale, offsets, horizontal mirror, and horizontal repeat.
- Quantize to 2, 3, 4, 5, 8, or 16 colors.
- Edit the palette directly or use a manual filament palette.
- Optionally displace the outside wall by image brightness.
- Preview the result in 3D with orbit controls and view presets.
- Export a 3MF archive with `/3D/3dmodel.model`, `[Content_Types].xml`, `_rels/.rels`, material colors, and PrusaSlicer-oriented metadata.

## Image Mapping

The outer side surface uses angular coordinate `u` and height coordinate `v`. Triangle material assignment samples the mapped image at the triangle center. Inner walls, rim, and bottom use the last palette color as the inside/base material.

## 3MF Compatibility

The exporter writes generic 3MF `basematerials` and per-triangle material references. It also follows the sibling Color Mix Shading app's PrusaSlicer strategy by adding `slic3rpe:mmu_segmentation` triangle attributes plus `Metadata/Slic3r_PE.config`, `Metadata/Slic3r_PE_model.config`, and `Metadata/Prusa_Slicer_full_spectrum.json`.

3MF color compatibility depends on slicer support. Tested target: PrusaSlicer.

## Known Limitations

- No dithering or color island cleanup yet.
- Meshes are generated in the browser main thread.
- Vase normals are approximate.
- Filament color matching uses RGB distance.
- PrusaSlicer behavior should be tested against target versions and MMU workflows.

## Roadmap

- ColorMix support.
- Arbitrary STL import.
- Region cleanup / island removal.
- Lab color matching.
- Real filament preset library.
- Curved plaque, lampshade, and ornament shapes.
- Better PrusaSlicer compatibility testing.
