"""Run after native-paint-browser-tests.mjs. Uses an isolated PrusaSlicer data directory."""
from pathlib import Path
import collections
import os
import re
import subprocess
import xml.etree.ElementTree as ET
import zipfile

workspace = Path(__file__).resolve().parent.parent
scratch = workspace / 'node_modules' / '.tmp'
slicer = os.environ.get('PRUSA_SLICER', r'C:\Program Files\Prusa3D\PrusaSlicer\prusa-slicer-console.exe')
source = scratch / 'native-paint.3mf'
roundtrip = scratch / 'native-paint-roundtrip.3mf'
gcode = scratch / 'native-paint.gcode'
common = [slicer, '--datadir', str(scratch / 'prusa-paint-test-data')]
subprocess.run(common + ['--info', '--export-3mf', '--output', str(roundtrip), str(source)], check=True)

def paint(path):
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read('3D/3dmodel.model'))
    return [triangle.get('{http://schemas.slic3r.org/3mf/2017/06}mmu_segmentation')
            for triangle in root.findall('.//{*}triangle')]

original = paint(source)
assert len(original) == 12
assert paint(roundtrip) == original, 'PrusaSlicer changed the paint trees or geometry face count'
subprocess.run(common + [
    '--export-gcode', '--nozzle-diameter', '0.4,0.4,0.4,0.4,0.4',
    '--filament-diameter', '1.75,1.75,1.75,1.75,1.75', '--layer-height', '0.3',
    '--fill-density', '0%', '--perimeters', '1', '--top-solid-layers', '0',
    '--bottom-solid-layers', '0', '--skirts', '0', '--output', str(gcode), str(source),
], check=True)
tools = collections.Counter(re.findall(r'^T\d+', gcode.read_text(), re.MULTILINE))
assert set(tools) == {'T0', 'T1', 'T2', 'T3', 'T4'}, 'Expected all five physical ColorMix tools'
print('PASS: PrusaSlicer preserves 12 geometry faces and exact paint trees; slices ColorMix paint:', tools)
