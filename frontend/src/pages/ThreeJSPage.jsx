import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceRadial } from 'd3-force-3d';
import apiClient from '../api/axios';
import { useNavigate } from 'react-router-dom';
import './GraphPage.css';

// Helper to strip HTML tags and entities
const stripHtml = (html) => {
  if (!html) return '';
  const tmp = document.createElement("DIV");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
};

function ThreeJSPage() {
  const mountRef = useRef(null);
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState(null);
  const [nodeDetails, setNodeDetails] = useState(null);
  const navigate = useNavigate();
  
  // Refs for cleanup
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const composerRef = useRef(null);
  const controlsRef = useRef(null);
  const animationRef = useRef(null);
  const simulationRef = useRef(null);

  // 获取图谱数据
  useEffect(() => {
    let cancelled = false;
    const fetchGraph = async () => {
      try {
        const res = await apiClient.get('/graph/knowledge-map');
        if (!cancelled) setGraphData(res.data);
      } catch (err) {
        console.error('获取图谱数据失败', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchGraph();
    return () => { cancelled = true; };
  }, []);

  // 获取节点详情
  useEffect(() => {
    if (!selectedNode) {
      setNodeDetails(null);
      return;
    }
    
    const fetchDetails = async () => {
      try {
        const res = await apiClient.get(`/knowledge-points/${selectedNode.id}`);
        setNodeDetails(res.data);
      } catch (err) {
        console.error('Failed to fetch node details', err);
      }
    };
    fetchDetails();
  }, [selectedNode]);

  useEffect(() => {
    const currentMount = mountRef.current;
    if (!currentMount || !graphData.nodes || graphData.nodes.length === 0) return;

    // --- 1. Scene Setup ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.002);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, currentMount.clientWidth / currentMount.clientHeight, 0.1, 2000);
    camera.position.set(0, 0, 200);

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
    renderer.toneMapping = THREE.ReinhardToneMapping;
    currentMount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    controlsRef.current = controls;

    // --- 2. Post-Processing (Bloom) ---
    const renderScene = new RenderPass(scene, camera);
    
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(currentMount.clientWidth, currentMount.clientHeight),
      1.5,  // strength
      0.4,  // radius
      0.85  // threshold
    );
    // 降低 Bloom 强度，提高清晰度
    bloomPass.strength = 0.6;
    bloomPass.radius = 0.4;
    bloomPass.threshold = 0.2;

    const outputPass = new OutputPass();

    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);
    composerRef.current = composer;

    // --- 3. Objects Creation ---
    const nodes = graphData.nodes.map(n => ({ ...n }));
    const links = graphData.links.map(l => ({ ...l }));

    const nodeMeshes = [];
    const linkLines = [];

    // Materials
    const nodeGeometry = new THREE.SphereGeometry(2.5, 32, 32);
    const nodeMaterialMastered = new THREE.MeshBasicMaterial({ color: 0x10b981 }); // Green
    const nodeMaterialLearning = new THREE.MeshBasicMaterial({ color: 0x3b82f6 }); // Blue
    const nodeMaterialDefault = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });  // Grey

    // Create Nodes
    const nodeGroup = new THREE.Group();
    scene.add(nodeGroup);

    // 创建文字标签 Sprite
    const createLabel = (text) => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      const fontSize = 48; // 更大的字体以提高清晰度
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
      
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(material);
      
      // 缩放 Sprite
      const scaleFactor = 0.25;
      sprite.scale.set(canvas.width * scaleFactor / 10, canvas.height * scaleFactor / 10, 1);
      sprite.position.y = 5; // 位于节点上方
      
      return sprite;
    };

    nodes.forEach(node => {
      let material = nodeMaterialDefault;
      if (node.status === 'mastered') material = nodeMaterialMastered;
      else if (node.status === 'in_progress') material = nodeMaterialLearning;

      const mesh = new THREE.Mesh(nodeGeometry, material);
      mesh.userData = { id: node.id, name: node.name || node.title, status: node.status };
      
      // 添加标签
      const label = createLabel(node.name || node.title || '未命名');
      mesh.add(label);

      nodeGroup.add(mesh);
      nodeMeshes.push(mesh);
      node.mesh = mesh; // Link d3 node to mesh
    });

    // Create Links
    const linkMaterial = new THREE.LineBasicMaterial({ 
      color: 0x475569, 
      transparent: true, 
      opacity: 0.3,
      blending: THREE.AdditiveBlending
    });

    const linkGroup = new THREE.Group();
    scene.add(linkGroup);

    links.forEach(link => {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(6); // 2 points * 3 coords
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const line = new THREE.Line(geometry, linkMaterial);
      linkGroup.add(line);
      linkLines.push(line);
      link.line = line;
    });

    // --- 4. Force Simulation ---
    const simulation = forceSimulation(nodes, 3) // 3D
      .numDimensions(3)
      .force('link', forceLink(links).id(d => d.id).distance(25)) // 缩短连接距离 (40 -> 25)
      .force('charge', forceManyBody().strength(-30)) // 减小排斥力 (-100 -> -30)
      .force('center', forceCenter(0, 0, 0))
      .force('radial', forceRadial(0, 0, 0, 0).strength(0.1)); // 增加向心力，防止过于分散
    
    simulationRef.current = simulation;

    // --- 5. Animation Loop ---
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);

      // Update Node Positions
      nodes.forEach(node => {
        if (node.mesh) {
          node.mesh.position.set(node.x, node.y, node.z);
        }
      });

      // Update Link Positions
      links.forEach(link => {
        if (link.line && link.source && link.target) {
          const positions = link.line.geometry.attributes.position.array;
          positions[0] = link.source.x;
          positions[1] = link.source.y;
          positions[2] = link.source.z;
          positions[3] = link.target.x;
          positions[4] = link.target.y;
          positions[5] = link.target.z;
          link.line.geometry.attributes.position.needsUpdate = true;
        }
      });

      controls.update();
      composer.render();
    };
    animate();

    // --- 6. Interaction ---
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onClick = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(nodeMeshes);

      if (intersects.length > 0) {
        const nodeData = intersects[0].object.userData;
        if (nodeData && nodeData.id) {
          setSelectedNode(nodeData);
          controls.autoRotate = false;
        }
      } else {
        // Click background to close sidebar
        setSelectedNode(null);
        controls.autoRotate = true;
      }
    };

    renderer.domElement.addEventListener('click', onClick);

    // --- Resize ---
    const handleResize = () => {
      if (!currentMount) return;
      camera.aspect = currentMount.clientWidth / currentMount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
      composer.setSize(currentMount.clientWidth, currentMount.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (renderer.domElement) {
        renderer.domElement.removeEventListener('click', onClick);
      }
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (simulationRef.current) simulationRef.current.stop();
      
      controls.dispose();
      renderer.dispose();
      composer.dispose();
      
      // Cleanup geometries/materials
      nodeGeometry.dispose();
      nodeMaterialMastered.dispose();
      nodeMaterialLearning.dispose();
      nodeMaterialDefault.dispose();
      linkMaterial.dispose();
      
      if (currentMount.contains(renderer.domElement)) {
        currentMount.removeChild(renderer.domElement);
      }
    };
  }, [graphData]);

  return (
    <div className="graph-page-container">
      <div className="graph-header" style={{ position: 'absolute', width: '100%', background: 'transparent', border: 'none', pointerEvents: 'none', zIndex: 10 }}>
        <h1 style={{ textShadow: '0 0 10px rgba(59, 130, 246, 0.8)' }}>3D 视界</h1>
        <p style={{ textShadow: '0 0 5px rgba(255,255,255,0.5)' }}>神经网络风格的知识连接视图</p>
      </div>
      
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
      
      {loading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
        </div>
      )}

      {/* Sidebar */}
      <div className={`graph-sidebar ${selectedNode ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2 className="sidebar-title">{selectedNode?.name || '知识点详情'}</h2>
          <button className="sidebar-close" onClick={() => setSelectedNode(null)}>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        
        <div className="sidebar-content">
          {selectedNode && (
            <>
              <div className="sidebar-meta">
                <span className={`sidebar-tag tag-${selectedNode.status || 'default'}`}>
                  {selectedNode.status === 'mastered' ? '已掌握' : (selectedNode.status === 'in_progress' ? '学习中' : '未开始')}
                </span>
              </div>
              
              {nodeDetails ? (
                <div className="prose prose-invert prose-sm">
                  <p>
                    {nodeDetails.content 
                      ? stripHtml(nodeDetails.content).slice(0, 300) + (stripHtml(nodeDetails.content).length > 300 ? '...' : '') 
                      : '暂无内容'}
                  </p>
                </div>
              ) : (
                <div className="loading-text">加载详情中...</div>
              )}
            </>
          )}
        </div>

        <div className="sidebar-actions">
          {selectedNode && (
            <button 
              className="btn btn-primary w-full"
              onClick={() => navigate(`/kp/${selectedNode.id}`)}
            >
              查看完整页面
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ThreeJSPage;
