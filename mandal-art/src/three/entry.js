/* Точка входа бандла 3D (tools/build_three.sh -> build/three.bundle.js). Берём ТОЛЬКО нужные классы three.js,
   чтобы сборщик выкинул остальное. Результат кладётся в window.M3D и исполняется лениво (06c-3d.js). */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, Points, Object3D, Vector2, Vector3, Color, Quaternion, Euler, Matrix4,
  BufferGeometry, BufferAttribute, Float32BufferAttribute, SphereGeometry, CylinderGeometry, TorusGeometry, LatheGeometry, PlaneGeometry,
  CircleGeometry, RingGeometry, BoxGeometry, OctahedronGeometry, IcosahedronGeometry, TubeGeometry, CatmullRomCurve3, ConeGeometry,
  MeshStandardMaterial, MeshPhysicalMaterial, MeshBasicMaterial, PointsMaterial,
  DirectionalLight, HemisphereLight, PointLight, AmbientLight,
  Sprite, SpriteMaterial, Texture, CanvasTexture, PMREMGenerator, AnimationMixer, Clock, MathUtils, Box3,
  SRGBColorSpace, ACESFilmicToneMapping, AdditiveBlending, DoubleSide, FrontSide, BackSide, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter, LoopRepeat
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

window.M3D = {
  version: '0.187.0',
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, Points, Object3D, Vector2, Vector3, Color, Quaternion, Euler, Matrix4,
  BufferGeometry, BufferAttribute, Float32BufferAttribute, SphereGeometry, CylinderGeometry, TorusGeometry, LatheGeometry, PlaneGeometry,
  CircleGeometry, RingGeometry, BoxGeometry, OctahedronGeometry, IcosahedronGeometry, TubeGeometry, CatmullRomCurve3, ConeGeometry,
  MeshStandardMaterial, MeshPhysicalMaterial, MeshBasicMaterial, PointsMaterial,
  DirectionalLight, HemisphereLight, PointLight, AmbientLight,
  Sprite, SpriteMaterial, Texture, CanvasTexture, PMREMGenerator, AnimationMixer, Clock, MathUtils, Box3,
  SRGBColorSpace, ACESFilmicToneMapping, AdditiveBlending, DoubleSide, FrontSide, BackSide, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter, LoopRepeat,
  GLTFLoader, RoomEnvironment, MeshoptDecoder
};
