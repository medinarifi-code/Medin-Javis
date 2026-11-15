/* global THREE */
// J.A.R.V.I.S. Orb – leuchtende, pulsierende Energiekugel mit HUD-Ringen.

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform float uAgitation;
  varying float vNoise;
  varying vec3 vNormal;

  // 3D Simplex-Noise (Ashima Arts)
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }

  void main(){
    float n = snoise(normal * (1.6 + uAgitation) + uTime * (0.35 + uAgitation * 0.8));
    vNoise = n;
    vNormal = normalize(normalMatrix * normal);
    float disp = n * (0.06 + uLevel * 0.35 + uAgitation * 0.05);
    vec3 pos = position + normal * disp;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = (2.2 + uLevel * 2.5) * (3.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;
  varying float vNoise;
  varying vec3 vNormal;
  void main(){
    float fres = pow(1.0 - abs(vNormal.z), 2.0);
    vec3 col = mix(uColorA, uColorB, clamp(vNoise * 0.5 + 0.5, 0.0, 1.0));
    gl_FragColor = vec4(col * (0.55 + fres * 1.4), uOpacity * (0.35 + fres));
  }
`;

const STATE_STYLE = {
  idle:      { a: [0.0, 0.75, 1.0], b: [0.2, 0.35, 1.0], agitation: 0.0, spin: 0.15 },
  listening: { a: [0.1, 1.0, 0.85], b: [0.0, 0.6, 1.0],  agitation: 0.3, spin: 0.35 },
  thinking:  { a: [0.55, 0.4, 1.0], b: [0.0, 0.8, 1.0],  agitation: 0.9, spin: 1.6 },
  speaking:  { a: [0.0, 0.9, 1.0],  b: [1.0, 0.7, 0.25], agitation: 0.4, spin: 0.5 },
  error:     { a: [1.0, 0.25, 0.2], b: [1.0, 0.55, 0.1], agitation: 0.6, spin: 0.3 },
};

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.2, "rgba(140,230,255,0.75)");
  grd.addColorStop(0.5, "rgba(0,150,255,0.18)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

function ring(radius, color, opacity, dashed = false, segments = 256) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.08, gapSize: 0.06, blending: THREE.AdditiveBlending })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending });
  const line = new THREE.Line(geo, mat);
  if (dashed) line.computeLineDistances();
  return line;
}

function arcTicks(radius, count, length, color, opacity) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const l = i % 5 === 0 ? length * 2 : length;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
    pts.push(new THREE.Vector3(Math.cos(a) * (radius + l), Math.sin(a) * (radius + l), 0));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending }));
}

export class Orb {
  constructor(container) {
    this.container = container;
    this.state = "idle";
    this.level = 0;
    this.targetLevel = 0;
    this.style = { ...STATE_STYLE.idle, a: [...STATE_STYLE.idle.a], b: [...STATE_STYLE.idle.b] };

    const w = container.clientWidth, h = container.clientHeight;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    this.camera.position.z = 5.2;

    this.uniforms = {
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uAgitation: { value: 0 },
      uColorA: { value: new THREE.Color(...this.style.a) },
      uColorB: { value: new THREE.Color(...this.style.b) },
      uOpacity: { value: 1 },
    };

    const shaderMat = (opacity) =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { ...this.uniforms, uOpacity: { value: opacity } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

    // Partikelhülle + Drahtgitter
    this.core = new THREE.Group();
    this.points = new THREE.Points(new THREE.IcosahedronGeometry(1, 48), shaderMat(1));
    this.wire = new THREE.Mesh(new THREE.IcosahedronGeometry(0.985, 12), shaderMat(0.25));
    this.wire.material.wireframe = true;
    this.core.add(this.points, this.wire);
    this.scene.add(this.core);

    // Glühen
    const tex = glowTexture();
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x33ccff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.scale.set(4.2, 4.2, 1);
    this.innerGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xaaf4ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.innerGlow.scale.set(1.6, 1.6, 1);
    this.scene.add(this.glow, this.innerGlow);

    // HUD-Ringe
    this.rings = new THREE.Group();
    const cyan = 0x22d3ff;
    this.r1 = ring(1.45, cyan, 0.55);
    this.r2 = ring(1.6, cyan, 0.35, true);
    this.r3 = arcTicks(1.75, 120, 0.04, cyan, 0.45);
    this.r4 = ring(2.05, cyan, 0.18, true);
    this.r5 = ring(1.3, 0x7af3ff, 0.25, true);
    this.rings.add(this.r1, this.r2, this.r3, this.r4, this.r5);
    this.scene.add(this.rings);

    // Gekippte Orbital-Ringe
    this.orbitals = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const o = ring(1.22 + i * 0.05, 0x55e0ff, 0.22);
      o.rotation.x = Math.PI / 2.4 + i * 0.4;
      o.rotation.y = i * 1.1;
      this.orbitals.add(o);
    }
    this.scene.add(this.orbitals);

    // Schwebende Staubpartikel
    const dust = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) {
      const r = 2.2 + Math.random() * 2.5, t = Math.random() * Math.PI * 2, p = Math.acos(2 * Math.random() - 1);
      dust.set([r * Math.sin(p) * Math.cos(t), r * Math.sin(p) * Math.sin(t), r * Math.cos(p) * 0.4], i * 3);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(dust, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0x3fbfff, size: 0.018, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.dust);

    this.clock = new THREE.Clock();
    window.addEventListener("resize", () => this.resize());
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  setState(state) {
    if (STATE_STYLE[state]) this.state = state;
  }

  /** Lautstärkepegel 0..1 (Mikrofon oder Stimme). */
  setLevel(v) {
    this.targetLevel = Math.max(0, Math.min(1, v));
  }

  animate() {
    requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    const target = STATE_STYLE[this.state];
    const k = 1 - Math.pow(0.02, dt);

    // Weiche Übergänge zwischen den Zuständen
    for (let i = 0; i < 3; i++) {
      this.style.a[i] += (target.a[i] - this.style.a[i]) * k;
      this.style.b[i] += (target.b[i] - this.style.b[i]) * k;
    }
    this.style.agitation += (target.agitation - this.style.agitation) * k;
    this.style.spin += (target.spin - this.style.spin) * k;

    let tl = this.targetLevel;
    if (this.state === "idle") tl = 0.06 + Math.sin(t * 1.3) * 0.04;
    if (this.state === "thinking") tl = 0.15 + Math.sin(t * 6) * 0.05;
    this.level += (tl - this.level) * (1 - Math.pow(0.0005, dt));

    this.uniforms.uTime.value = t;
    this.uniforms.uLevel.value = this.level;
    this.uniforms.uAgitation.value = this.style.agitation;
    this.uniforms.uColorA.value.setRGB(...this.style.a);
    this.uniforms.uColorB.value.setRGB(...this.style.b);

    const spin = this.style.spin;
    this.core.rotation.y += dt * spin * 0.5;
    this.core.rotation.x = Math.sin(t * 0.2) * 0.2;
    const s = 1 + this.level * 0.25;
    this.core.scale.setScalar(s);

    this.r1.rotation.z += dt * spin * 0.3;
    this.r2.rotation.z -= dt * spin * 0.5;
    this.r3.rotation.z += dt * spin * 0.15;
    this.r4.rotation.z -= dt * spin * 0.1;
    this.r5.rotation.z += dt * spin * 0.8;
    this.rings.scale.setScalar(1 + this.level * 0.08);
    this.orbitals.rotation.y += dt * spin * 0.6;
    this.orbitals.rotation.z += dt * spin * 0.2;
    this.dust.rotation.z += dt * 0.02;
    this.dust.rotation.y = Math.sin(t * 0.1) * 0.2;

    const glowCol = new THREE.Color(...this.style.a);
    this.glow.material.color.copy(glowCol);
    this.glow.material.opacity = 0.55 + this.level * 0.8;
    this.glow.scale.setScalar(4.0 + this.level * 2.2);
    this.innerGlow.material.opacity = 0.5 + this.level;
    this.innerGlow.scale.setScalar(1.4 + this.level * 1.2);

    this.renderer.render(this.scene, this.camera);
  }
}
