function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function spawnExplosion(particles, x, y, intensity = 1) {
  const num = 8 + Math.floor(4 * intensity);
  for (let i = 0; i < num; i++) {
    const angle = (i / num) * Math.PI * 2;
    const speed = rand(2, 5) * intensity;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.7, // slight down bias
      life: rand(25, 35),
      maxLife: rand(25, 35),
      type: "explosion",
      scale: rand(0.8, 1.2),
    });
  }
}

function spawnSparkle(particles, x, y, intensity = 1) {
  const num = 3 + Math.floor(2 * intensity);
  for (let i = 0; i < num; i++) {
    particles.push({
      x,
      y,
      vx: rand(-1.5, 1.5) * intensity,
      vy: rand(-3, -1) * intensity,
      life: rand(35, 50),
      maxLife: rand(35, 50),
      type: "sparkle",
      scale: rand(0.8, 1.2),
      rot: rand(0, Math.PI * 2),
      rotSpeed: rand(-0.3, 0.3),
    });
  }
}
