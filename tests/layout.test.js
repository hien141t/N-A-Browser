// Regression tests for multi-window desktop layout (no Electron runtime needed).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const begin = source.indexOf('function getLockedAspect(');
const end = source.indexOf('// Rearrange all currently running browser windows into clean layout', begin);
assert.ok(begin >= 0 && end > begin, 'Could not extract layout helpers');
const { getLockedAspect, tileWindowLayouts } = vm.runInNewContext(
  source.slice(begin, end) + '\n({getLockedAspect,tileWindowLayouts})'
);

function profile(mode) {
  return { orientationLock:mode, device:{viewport:{width:393,height:852}} };
}
function assertTiled(count, mode, area) {
  const windows = Array.from({length:count}, () => profile(mode));
  const tiles = tileWindowLayouts(windows, {mode:'grid',autoAdapt:true,gapX:10,gapY:10}, area);
  assert.equal(tiles.length,count);
  for (const t of tiles) {
    assert.ok(t.winW>0 && t.winH>0);
    assert.ok(t.posX>=area.x && t.posY>=area.y, 'window starts outside the display');
    assert.ok(t.posX+t.winW<=area.x+area.width, 'window extends beyond screen width');
    assert.ok(t.posY+t.winH<=area.y+area.height, 'window extends beyond screen height');
  }
  for(let i=0;i<tiles.length;i++)for(let j=i+1;j<tiles.length;j++){
    const a=tiles[i],b=tiles[j];
    const overlap=a.posX<b.posX+b.winW && a.posX+a.winW>b.posX &&
                  a.posY<b.posY+b.winH && a.posY+a.winH>b.posY;
    assert.equal(overlap,false,'windows overlap');
  }
}

test('orientation ratio locks portrait and landscape',()=>{
  const portrait = getLockedAspect(profile('portrait'));
  const landscape = getLockedAspect(profile('landscape'));
  assert.ok(portrait<1 && landscape>1);
  assert.ok(Math.abs(portrait*landscape-1)<0.001);
  assert.equal(getLockedAspect(profile('auto')),null);
});

test('five portrait windows fit 1920x1080',()=>{
  assertTiled(5,'portrait',{x:0,y:0,width:1920,height:1080});
});
test('six landscape windows fit 1920x1080',()=>{
  assertTiled(6,'landscape',{x:0,y:0,width:1920,height:1080});
});
test('ten portrait windows fit 1366x768',()=>{
  assertTiled(10,'portrait',{x:0,y:0,width:1366,height:768});
});
test('mixed orientation windows fit a secondary display',()=>{
  const area={x:1920,y:0,width:1440,height:900};
  const modes=['portrait','landscape','portrait','landscape','portrait','landscape'];
  const windows=modes.map(mode=>profile(mode));
  const tiles=tileWindowLayouts(windows,{mode:'grid',autoAdapt:true,gapX:8,gapY:8},area);
  assert.equal(tiles.length,6);
  assert.ok(tiles.every(t=>t.posX>=area.x && t.posY>=area.y &&
    t.posX+t.winW<=area.x+area.width && t.posY+t.winH<=area.y+area.height));
});
