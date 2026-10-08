import { useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Label, Slider, SliderThumb, SliderTrack, Switch } from "react-aria-components";

function Moon({ speed }: { speed: number }) {
  const pivot = useRef<any>(null);
  useFrame((_, dt) => { if (pivot.current) pivot.current.rotation.y += dt * speed * 0.9; });
  return (
    <group ref={pivot} rotation={[0.18, 0, 0]}>
      <mesh position={[2.3, 0, 0]}>
        <sphereGeometry args={[0.27, 32, 32]} />
        <meshStandardMaterial color="#cfd3d6" roughness={0.9} />
      </mesh>
    </group>
  );
}

function Earth({ speed }: { speed: number }) {
  const body = useRef<any>(null);
  useFrame((_, dt) => { if (body.current) body.current.rotation.y += dt * speed * 2.4; });
  return (
    <mesh ref={body} rotation={[0.41, 0, 0]}>
      <icosahedronGeometry args={[1, 3]} />
      <meshStandardMaterial color="#7aaaff" flatShading roughness={0.55} />
    </mesh>
  );
}

export default function EarthAndMoon() {
  const [speed, setSpeed] = useState(1);
  const [trail, setTrail] = useState(true);
  return (
    <div className="overflow-hidden rounded-2xl border border-[#ffffff1f] bg-[#232324] text-[#f9fafb]">
      <div className="h-[220px] bg-[#151517]">
        <Canvas camera={{ position: [0, 1.6, 5.2], fov: 42 }}>
          <ambientLight intensity={0.35} />
          <directionalLight position={[4, 2, 3]} intensity={2.2} />
          <Earth speed={speed} />
          <Moon speed={speed} />
          {trail && (
            <mesh rotation={[Math.PI / 2 + 0.18, 0, 0]}>
              <torusGeometry args={[2.3, 0.006, 8, 160]} />
              <meshBasicMaterial color="#7aaaff" transparent opacity={0.45} />
            </mesh>
          )}
        </Canvas>
      </div>
      <div className="flex items-center gap-5 px-5 py-4">
        <Slider value={speed} onChange={setSpeed} minValue={0.2} maxValue={4} step={0.1} className="flex flex-1 flex-col gap-1.5">
          <Label className="text-[13px] text-[#cfd3d6]">Time ×{speed.toFixed(1)}</Label>
          <SliderTrack className="relative h-5 w-full">
            <div className="absolute top-[9px] h-[2px] w-full rounded-full bg-[#ffffff29]" />
            <SliderThumb className="top-2.5 h-4 w-4 rounded-full bg-[#f9fafb] outline-none" />
          </SliderTrack>
        </Slider>
        <Switch isSelected={trail} onChange={setTrail} className="group flex items-center gap-2 text-[13px] text-[#cfd3d6]">
          <span className="flex h-5 w-9 items-center rounded-full bg-[#43454a] px-0.5 transition-colors group-data-[selected]:bg-[#7aaaff]">
            <span className="h-4 w-4 rounded-full bg-white transition-transform group-data-[selected]:translate-x-4" />
          </span>
          Orbit
        </Switch>
      </div>
    </div>
  );
}
