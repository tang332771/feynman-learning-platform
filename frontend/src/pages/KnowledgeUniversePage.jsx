import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import apiClient from '../api/axios';
import { Link } from 'react-router-dom';
import './KnowledgeUniversePage.css';

// Helper to strip HTML tags and entities
const stripHtml = (html) => {
  if (!html) return '';
  const tmp = document.createElement("DIV");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
};

function KnowledgeUniversePage() {
  const mountRef = useRef(null);
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const nodesRef = useRef([]);
  const rendererRef = useRef(null);
  const animationRef = useRef(null);

  // 1) 获取知识图谱数据 (Nodes + Links)
  useEffect(() => {
    let cancelled = false;
    const fetchGraphData = async () => {
      try {
        // 使用图谱 API 获取节点和连接关系
        const res = await apiClient.get('/graph/knowledge-map');
        if (!cancelled) {
          const data = res.data || { nodes: [], links: [] };
          // 转换节点格式以匹配组件预期
          const nodes = (data.nodes || []).map(n => ({
            _id: n.id,
            title: n.name,
            content: n.value,
            ...n
          }));
          setGraphData({ nodes, links: data.links || [] });
        }
      } catch (err) {
        console.error('Failed to fetch knowledge graph data', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchGraphData();
    return () => { cancelled = true; };
  }, []);

  // 2) 初始化 3D 场景
  useEffect(() => {
    const currentMount = mountRef.current;
    if (!currentMount) return;

    const { nodes: knowledgePoints, links } = graphData;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020617); // 深邃的夜空蓝
    scene.fog = new THREE.FogExp2(0x020617, 0.0015);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, currentMount.clientWidth / currentMount.clientHeight, 0.1, 3000);
    camera.position.set(0, 60, 200);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
    currentMount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    controls.minDistance = 50;
    controls.maxDistance = 800;
    controlsRef.current = controls;

    // --- 灯光 ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // 提高环境光亮度 (0.4 -> 0.6)
    scene.add(ambientLight);
    
    const sunLight = new THREE.PointLight(0xffffff, 3, 1000); // 提高主光源亮度 (2 -> 3)
    sunLight.position.set(100, 50, 100);
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x3b82f6, 1);
    rimLight.position.set(-50, 0, -50);
    scene.add(rimLight);

    // --- 星空背景 ---
    const createStarfield = () => {
      const starsGeometry = new THREE.BufferGeometry();
      const starsCount = 3000;
      const posArray = new Float32Array(starsCount * 3);
      const sizeArray = new Float32Array(starsCount);
      
      for(let i = 0; i < starsCount * 3; i += 3) {
        const r = 800 + Math.random() * 800;
        const theta = 2 * Math.PI * Math.random();
        const phi = Math.acos(2 * Math.random() - 1);
        
        posArray[i] = r * Math.sin(phi) * Math.cos(theta);
        posArray[i+1] = r * Math.sin(phi) * Math.sin(theta);
        posArray[i+2] = r * Math.cos(phi);

        sizeArray[i/3] = Math.random() * 2;
      }
      
      starsGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
      starsGeometry.setAttribute('size', new THREE.BufferAttribute(sizeArray, 1));
      
      const starsMaterial = new THREE.PointsMaterial({
        size: 1.5,
        color: 0xffffff,
        transparent: true,
        opacity: 0.8,
        sizeAttenuation: true
      });
      
      const starMesh = new THREE.Points(starsGeometry, starsMaterial);
      scene.add(starMesh);
    };
    createStarfield();

    // --- 动态星尘 ---
    let stardustMesh;
    const createStardust = () => {
      const particleCount = 2000;
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(particleCount * 3);
      const colors = new Float32Array(particleCount * 3);
      
      const color1 = new THREE.Color(0x3b82f6); // Blue
      const color2 = new THREE.Color(0x8b5cf6); // Purple
      const color3 = new THREE.Color(0xf59e0b); // Amber

      for (let i = 0; i < particleCount; i++) {
        // 螺旋分布，模拟星系盘
        const r = 40 + Math.random() * 400; // 从地球附近开始向外延伸
        const theta = Math.random() * Math.PI * 2;
        // 越靠近中心越厚，越远越薄
        const spread = 1000 / r; 
        const y = (Math.random() - 0.5) * spread * 10;

        positions[i * 3] = r * Math.cos(theta);
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = r * Math.sin(theta);

        // 随机颜色混合
        const choice = Math.random();
        let mixedColor;
        if (choice < 0.33) mixedColor = color1;
        else if (choice < 0.66) mixedColor = color2;
        else mixedColor = color3;

        colors[i * 3] = mixedColor.r;
        colors[i * 3 + 1] = mixedColor.g;
        colors[i * 3 + 2] = mixedColor.b;
      }

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const material = new THREE.PointsMaterial({
        size: 0.8,
        vertexColors: true,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });

      stardustMesh = new THREE.Points(geometry, material);
      scene.add(stardustMesh);
    };
    createStardust();

    // --- 中心地球 ---
    const earthGroup = new THREE.Group();
    scene.add(earthGroup);

    // 加载地球纹理 (使用预构建/安全加载模式，防止纹理加载失败导致变黑)
    const textureLoader = new THREE.TextureLoader();
    
    // 地球本体 - 初始状态为蓝色球体，纹理加载成功后覆盖
    const earthGeometry = new THREE.SphereGeometry(20, 64, 64);
    const earthMaterial = new THREE.MeshPhongMaterial({
      color: 0x1c4e99, // 初始深蓝色，防止黑屏
      specular: 0x333333,
      shininess: 5
    });
    const earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
    earthGroup.add(earthMesh);

    // 异步加载纹理
    const earthMapUrl = 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_2048.jpg';
    const earthSpecularUrl = 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_specular_2048.jpg';
    const earthNormalUrl = 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_normal_2048.jpg';

    textureLoader.load(earthMapUrl, (texture) => {
      earthMaterial.map = texture;
      earthMaterial.color.setHex(0xffffff); // 纹理加载后设为白色以显示原色
      earthMaterial.needsUpdate = true;
    }, undefined, (err) => console.warn("Earth map failed, keeping fallback color"));

    textureLoader.load(earthSpecularUrl, (texture) => {
      earthMaterial.specularMap = texture;
      earthMaterial.needsUpdate = true;
    });

    textureLoader.load(earthNormalUrl, (texture) => {
      earthMaterial.normalMap = texture;
      earthMaterial.needsUpdate = true;
    });

    // 云层 (稍微大一点的球体)
    const cloudGeometry = new THREE.SphereGeometry(20.2, 64, 64);
    const cloudMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0, // 初始不可见，加载后显示
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const cloudMesh = new THREE.Mesh(cloudGeometry, cloudMaterial);
    earthGroup.add(cloudMesh);

    textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_clouds_1024.png', (texture) => {
      cloudMaterial.map = texture;
      cloudMaterial.opacity = 0.8;
      cloudMaterial.needsUpdate = true;
    });

    // 地球线框（保留一点科技感，但更淡）
    const wireframeGeometry = new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(20.5, 2));
    const wireframeMaterial = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.05 });
    const wireframe = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
    earthGroup.add(wireframe);

    // 大气层光晕
    const atmosphereGeometry = new THREE.SphereGeometry(22, 64, 64);
    const atmosphereMaterial = new THREE.MeshBasicMaterial({
      color: 0x60a5fa,
      transparent: true,
      opacity: 0.1,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending
    });
    const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
    earthGroup.add(atmosphere);

    // --- 知识点卫星 ---
    const satellites = [];
    const satelliteMap = {}; // ID -> Group 映射，用于连接连线
    const orbitLines = [];
    
    // 材质池 - 使用纹理并混合颜色，打造星球质感
    const planetRockTexture = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/moon_1024.jpg');
    
    const satelliteMaterials = [
      new THREE.MeshStandardMaterial({ 
        map: planetRockTexture,
        bumpMap: planetRockTexture,
        bumpScale: 0.1,
        color: 0xf59e0b, 
        emissive: 0xf59e0b,
        emissiveIntensity: 0.2,
        roughness: 0.8, 
        metalness: 0.1 
      }), // Amber
      new THREE.MeshStandardMaterial({ 
        map: planetRockTexture,
        bumpMap: planetRockTexture,
        bumpScale: 0.1,
        color: 0x10b981, 
        emissive: 0x10b981,
        emissiveIntensity: 0.2,
        roughness: 0.8, 
        metalness: 0.1 
      }), // Green
      new THREE.MeshStandardMaterial({ 
        map: planetRockTexture,
        bumpMap: planetRockTexture,
        bumpScale: 0.1,
        color: 0xec4899, 
        emissive: 0xec4899,
        emissiveIntensity: 0.2,
        roughness: 0.8, 
        metalness: 0.1 
      }), // Pink
      new THREE.MeshStandardMaterial({ 
        map: planetRockTexture,
        bumpMap: planetRockTexture,
        bumpScale: 0.1,
        color: 0x8b5cf6, 
        emissive: 0x8b5cf6,
        emissiveIntensity: 0.2,
        roughness: 0.8, 
        metalness: 0.1 
      }), // Purple
      new THREE.MeshStandardMaterial({ 
        map: planetRockTexture,
        bumpMap: planetRockTexture,
        bumpScale: 0.1,
        color: 0x06b6d4, 
        emissive: 0x06b6d4,
        emissiveIntensity: 0.2,
        roughness: 0.8, 
        metalness: 0.1 
      }), // Cyan
    ];

    // 创建文字标签 Sprite
    const createLabel = (text) => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      const fontSize = 24;
      context.font = `Bold ${fontSize}px Arial`;
      const metrics = context.measureText(text);
      const width = metrics.width;
      
      canvas.width = width + 20;
      canvas.height = fontSize + 20;
      
      context.font = `Bold ${fontSize}px Arial`;
      context.fillStyle = 'rgba(255, 255, 255, 1)';
      context.shadowColor = 'rgba(0, 0, 0, 1)';
      context.shadowBlur = 4;
      context.fillText(text, 10, fontSize);
      
      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
      const sprite = new THREE.Sprite(material);
      
      // 缩放 Sprite 以匹配文字大小
      const scaleFactor = 0.5;
      sprite.scale.set(canvas.width * scaleFactor / 10, canvas.height * scaleFactor / 10, 1);
      sprite.position.y = 6; // 位于星球上方 (调整高度以适应更大的星球)
      
      return sprite;
    };

    if (knowledgePoints.length > 0) {
      knowledgePoints.forEach((kp, i) => {
        // 计算轨道参数
        // 分层轨道：每层轨道半径不同，避免拥挤
        const layerIndex = i % 5; 
        const radius = 40 + layerIndex * 15 + Math.random() * 10; // 轨道半径 40 ~ 100+
        const speed = (0.002 + Math.random() * 0.003) * 0.2; // 随机速度 (降低为原来的 20%)
        const angle = (i / knowledgePoints.length) * Math.PI * 2 + Math.random(); // 均匀分布初始角度
        const inclination = (Math.random() - 0.5) * 0.5; // 轨道倾角 (-0.25 ~ 0.25 rad)
        
        // 卫星容器 (Group)
        const satelliteGroup = new THREE.Group();
        
        // 星球本体 Mesh
        const geometry = new THREE.SphereGeometry(4, 32, 32); 
        const material = satelliteMaterials[i % satelliteMaterials.length].clone();
        // 增加凹凸感
        material.bumpScale = 0.5;
        material.roughness = 0.7;
        
        const planetMesh = new THREE.Mesh(geometry, material);
        // 随机自转轴
        planetMesh.rotation.z = Math.random() * Math.PI; 
        planetMesh.userData = { rotationSpeed: 0.005 + Math.random() * 0.01 };
        
        satelliteGroup.add(planetMesh);
        
        satelliteGroup.userData = {
          id: kp._id,
          title: kp.title,
          content: kp.content,
          originalMaterial: material,
          orbit: { radius, speed, angle, inclination },
          planetMesh: planetMesh // 引用星球Mesh以便旋转
        };
        
        // 添加文字标签 (添加到 Group，不随星球自转)
        const label = createLabel(kp.title);
        satelliteGroup.add(label);

        scene.add(satelliteGroup);
        satellites.push(satelliteGroup);
        satelliteMap[kp._id] = satelliteGroup; // 存入 Map

        // 绘制轨道线 (可选，增加视觉效果)
        const orbitCurve = new THREE.EllipseCurve(
          0, 0,            // ax, aY
          radius, radius,  // xRadius, yRadius
          0, 2 * Math.PI,  // aStartAngle, aEndAngle
          false,           // aClockwise
          0                // aRotation
        );
        
        const points = orbitCurve.getPoints(64);
        const orbitGeometry = new THREE.BufferGeometry().setFromPoints(points);
        // 旋转轨道以匹配倾角
        orbitGeometry.rotateX(Math.PI / 2 + inclination); 
        
        const orbitMaterial = new THREE.LineBasicMaterial({ 
          color: 0xffffff, 
          transparent: true, 
          opacity: 0.05 
        });
        const orbitLine = new THREE.Line(orbitGeometry, orbitMaterial);
        scene.add(orbitLine);
        orbitLines.push(orbitLine);
      });
    }
    nodesRef.current = satellites;

    // --- 连线 (Links) ---
    let linksMesh;
    if (links && links.length > 0) {
        const linkGeometry = new THREE.BufferGeometry();
        const linkPositions = new Float32Array(links.length * 2 * 3); // 2 points * 3 coords
        linkGeometry.setAttribute('position', new THREE.BufferAttribute(linkPositions, 3));
        
        const linkMaterial = new THREE.LineBasicMaterial({
            color: 0x60a5fa, // 浅蓝色连线
            transparent: true,
            opacity: 0.2,
            blending: THREE.AdditiveBlending
        });
        
        linksMesh = new THREE.LineSegments(linkGeometry, linkMaterial);
        scene.add(linksMesh);
    }

    // --- 交互逻辑 ---
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let hoveredNode = null;

    const onMouseMove = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    };

    const onClick = () => {
      if (hoveredNode) {
        setSelectedNode({
          id: hoveredNode.userData.id,
          title: hoveredNode.userData.title,
          content: hoveredNode.userData.content
        });
        
        // 聚焦相机
        const targetPos = hoveredNode.position.clone();
        controls.target.copy(targetPos);
        controls.autoRotate = false;
      } else {
        setSelectedNode(null);
        controls.autoRotate = true;
        controls.target.set(0, 0, 0); // 回到中心
      }
    };

    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('click', onClick);

    // --- 动画循环 ---
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      
      // 地球自转
      earthGroup.rotation.y += 0.001;
      if (cloudMesh) cloudMesh.rotation.y += 0.0005; // 云层流动
      if (wireframe) wireframe.rotation.y -= 0.0005; // 线框反向慢转
      
      // 星尘旋转
      if (stardustMesh) {
        stardustMesh.rotation.y += 0.0002;
      }

      // 卫星公转与自转
      satellites.forEach(group => {
        const orbit = group.userData.orbit;
        orbit.angle += orbit.speed;
        
        // 计算位置：极坐标转笛卡尔坐标，并应用倾角
        const x = orbit.radius * Math.cos(orbit.angle);
        const z = orbit.radius * Math.sin(orbit.angle);
        const y = x * Math.sin(orbit.inclination); // 简单的倾角应用
        
        // 修正 x 以保持圆轨道投影
        const xFinal = x * Math.cos(orbit.inclination);

        group.position.set(xFinal, y, z);
        
        // 星球自转
        if (group.userData.planetMesh) {
          group.userData.planetMesh.rotation.y += group.userData.planetMesh.userData.rotationSpeed;
        }
      });

      // 更新连线位置
      if (linksMesh && links.length > 0) {
          const positions = linksMesh.geometry.attributes.position.array;
          let idx = 0;
          links.forEach(link => {
              const sourceNode = satelliteMap[link.source];
              const targetNode = satelliteMap[link.target];
              
              if (sourceNode && targetNode) {
                  positions[idx++] = sourceNode.position.x;
                  positions[idx++] = sourceNode.position.y;
                  positions[idx++] = sourceNode.position.z;
                  
                  positions[idx++] = targetNode.position.x;
                  positions[idx++] = targetNode.position.y;
                  positions[idx++] = targetNode.position.z;
              } else {
                  // 如果找不到节点（可能被过滤），将线段折叠到原点
                  for(let k=0; k<6; k++) positions[idx++] = 0;
              }
          });
          linksMesh.geometry.attributes.position.needsUpdate = true;
      }

      // Raycaster 检测 (需要递归检测 Group 的子对象)
      raycaster.setFromCamera(mouse, camera);
      // 注意：satellites 现在是 Group 数组，我们需要检测 Group 内部的 Mesh
      // intersectObjects 第二个参数 true 表示递归检测子对象
      const intersects = raycaster.intersectObjects(satellites, true);
      
      if (intersects.length > 0) {
        // 找到被点击的 Mesh 的父级 Group (因为数据存在 Group 上)
        // 注意：intersects[0].object 是 Mesh (星球本体或文字Sprite)
        // 我们只关心星球本体 Mesh
        let targetObject = intersects[0].object;
        
        // 如果点到的是 Sprite，忽略或向上找 Group
        if (targetObject.type === 'Sprite') {
           targetObject = targetObject.parent; // Sprite 的父级是 Group
        } else if (targetObject.type === 'Mesh') {
           targetObject = targetObject.parent; // Mesh 的父级是 Group
        }
        
        if (targetObject && targetObject.userData && targetObject.userData.id) {
            if (hoveredNode !== targetObject) {
              // 恢复上一个高亮节点
              if (hoveredNode && hoveredNode.userData.planetMesh) {
                 hoveredNode.userData.planetMesh.scale.set(1, 1, 1);
                 hoveredNode.userData.planetMesh.material.emissiveIntensity = 0.2;
              }
              
              hoveredNode = targetObject;
              
              // 高亮当前节点
              if (hoveredNode.userData.planetMesh) {
                hoveredNode.userData.planetMesh.scale.set(1.5, 1.5, 1.5);
                hoveredNode.userData.planetMesh.material.emissiveIntensity = 1.0; 
              }
              document.body.style.cursor = 'pointer';
            }
        }
      } else {
        if (hoveredNode) {
          if (hoveredNode.userData.planetMesh) {
            hoveredNode.userData.planetMesh.scale.set(1, 1, 1);
            hoveredNode.userData.planetMesh.material.emissiveIntensity = 0.2;
          }
          hoveredNode = null;
          document.body.style.cursor = 'default';
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // --- Resize ---
    const handleResize = () => {
      if (!currentMount) return;
      camera.aspect = currentMount.clientWidth / currentMount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (renderer.domElement) {
        renderer.domElement.removeEventListener('mousemove', onMouseMove);
        renderer.domElement.removeEventListener('click', onClick);
      }
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      
      controls.dispose();
      renderer.dispose();
      
      // 资源清理
      if (stardustMesh) {
        stardustMesh.geometry.dispose();
        stardustMesh.material.dispose();
      }
      if (linksMesh) {
        linksMesh.geometry.dispose();
        linksMesh.material.dispose();
      }
      
      earthGeometry.dispose();
      earthMaterial.dispose();
      cloudGeometry.dispose();
      cloudMaterial.dispose();
      wireframeGeometry.dispose();
      wireframeMaterial.dispose();
      atmosphereGeometry.dispose();
      atmosphereMaterial.dispose();
      
      satellites.forEach(group => {
        // Group 本身没有 geometry/material，需要清理子对象
        if (group.userData.planetMesh) {
            group.userData.planetMesh.geometry.dispose();
            group.userData.planetMesh.material.dispose();
        }
        // 清理 Sprite 标签
        group.children.forEach(child => {
            if (child.isSprite) {
                if (child.material.map) child.material.map.dispose();
                child.material.dispose();
            }
        });
      });
      
      orbitLines.forEach(l => {
        l.geometry.dispose();
        l.material.dispose();
      });

      if (currentMount.contains(renderer.domElement)) {
        currentMount.removeChild(renderer.domElement);
      }
    };
  }, [graphData]);

  // 搜索处理
  const handleSearch = (e) => {
    const term = e.target.value;
    setSearchTerm(term);
    
    if (!term.trim()) return;

    const targetNode = nodesRef.current.find(node => 
      node.userData.title.toLowerCase().includes(term.toLowerCase())
    );

    if (targetNode && controlsRef.current) {
      controlsRef.current.target.copy(targetNode.position);
      controlsRef.current.autoRotate = false;
      setSelectedNode({
        id: targetNode.userData.id,
        title: targetNode.userData.title,
        content: targetNode.userData.content
      });
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">知识宇宙</h1>
          <p className="page-subtitle">探索你的知识星系，发现知识点之间的隐秘联系。</p>
        </div>
      </div>

      <div className="universe-container">
        {loading && <div className="loading-overlay">正在构建宇宙...</div>}
        
        <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

        <div className="universe-overlay">
          <div className="universe-controls">
            <input 
              type="text" 
              className="universe-search" 
              placeholder="搜索知识星球..." 
              value={searchTerm}
              onChange={handleSearch}
            />
          </div>

          {selectedNode && (
            <div className="universe-detail-card">
              <h3 className="detail-title">{selectedNode.title}</h3>
              <div className="detail-content">
                {selectedNode.content 
                  ? stripHtml(selectedNode.content).slice(0, 150) + (stripHtml(selectedNode.content).length > 150 ? '...' : '') 
                  : '暂无内容'}
              </div>
              <div className="detail-actions">
                <Link to={`/kp/${selectedNode.id}`} className="btn btn-primary btn-sm">查看详情</Link>
                <Link to={`/graph`} className="btn btn-secondary btn-sm">查看图谱</Link>
                <button 
                  className="btn btn-ghost btn-sm" 
                  onClick={() => {
                    setSelectedNode(null);
                    if (controlsRef.current) {
                      controlsRef.current.autoRotate = true;
                      controlsRef.current.target.set(0, 0, 0);
                    }
                  }}
                >
                  关闭
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default KnowledgeUniversePage;
