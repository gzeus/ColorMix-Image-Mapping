import * as THREE from 'three';

// A temporary GPU overlay: moving an image never refines or recolors the mesh.
export function projectionUniforms() {
  return {
    imageProjectionEnabled: { value: false },
    imageProjectionTexture: { value: null as THREE.Texture | null },
    imageProjectionCenter: { value: new THREE.Vector3() },
    imageProjectionRight: { value: new THREE.Vector3(1, 0, 0) },
    imageProjectionUp: { value: new THREE.Vector3(0, 1, 0) },
    imageProjectionDirection: { value: new THREE.Vector3(0, 0, 1) },
    imageProjectionSize: { value: new THREE.Vector2(1, 1) },
    imageProjectionScale: { value: 1 },
    imageProjectionOffset: { value: new THREE.Vector2() },
    imageProjectionMirror: { value: false },
    imageProjectionFlip: { value: false },
    imageProjectionRepeat: { value: new THREE.Vector2() },
    imageProjectionFit: { value: 0 },
    imageProjectionAspect: { value: 1 },
    imageProjectionAngle: { value: 0 },
    imageProjectionVisibleOnly: { value: true },
  };
}

export function attachProjectionOverlay(material: THREE.Material, uniforms: ReturnType<typeof projectionUniforms>) {
  material.customProgramCacheKey = () => 'image-placement-overlay-v1';
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
varying vec3 imageProjectionPosition;
varying vec3 imageProjectionNormal;`).replace('#include <project_vertex>', `#include <project_vertex>
imageProjectionPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
imageProjectionNormal = mat3(modelMatrix) * normal;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 imageProjectionPosition;
varying vec3 imageProjectionNormal;
uniform bool imageProjectionEnabled;
uniform sampler2D imageProjectionTexture;
uniform vec3 imageProjectionCenter;
uniform vec3 imageProjectionRight;
uniform vec3 imageProjectionUp;
uniform vec3 imageProjectionDirection;
uniform vec2 imageProjectionSize;
uniform float imageProjectionScale;
uniform vec2 imageProjectionOffset;
uniform bool imageProjectionMirror;
uniform bool imageProjectionFlip;
uniform vec2 imageProjectionRepeat;
uniform int imageProjectionFit;
uniform float imageProjectionAspect;
uniform float imageProjectionAngle;
uniform bool imageProjectionVisibleOnly;`).replace('#include <color_fragment>', `#include <color_fragment>
if (imageProjectionEnabled && (!imageProjectionVisibleOnly || abs(dot(normalize(imageProjectionNormal), imageProjectionDirection)) > 0.2588190451)) {
  vec3 relative = imageProjectionPosition - imageProjectionCenter;
  float x = dot(relative, imageProjectionRight), y = dot(relative, imageProjectionUp);
  float c = cos(imageProjectionAngle), s = sin(imageProjectionAngle);
  vec2 uv = vec2((x * c + y * s) / imageProjectionSize.x, (-x * s + y * c) / imageProjectionSize.y) + 0.5;
  uv = vec2(imageProjectionMirror ? 1.0 - uv.x : uv.x, imageProjectionFlip ? uv.y : 1.0 - uv.y);
  uv = (uv - 0.5) / imageProjectionScale + 0.5 + imageProjectionOffset;
  float ratio = imageProjectionAspect / (imageProjectionSize.x / imageProjectionSize.y);
  if (imageProjectionFit == 1) {
    if (ratio > 1.0) uv.y = (uv.y - 0.5) * ratio + 0.5;
    else uv.x = (uv.x - 0.5) / ratio + 0.5;
  } else if (imageProjectionFit == 2) {
    if (ratio > 1.0) uv.x = (uv.x - 0.5) / ratio + 0.5;
    else uv.y = (uv.y - 0.5) * ratio + 0.5;
  }
  if (imageProjectionRepeat.x > 0.5) uv.x = fract(uv.x);
  if (imageProjectionRepeat.y > 0.5) uv.y = fract(uv.y);
  if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
    vec4 imageColor = texture2D(imageProjectionTexture, uv);
    diffuseColor.rgb = mix(diffuseColor.rgb, imageColor.rgb, imageColor.a * 0.7);
  }
}`);
  };
}
