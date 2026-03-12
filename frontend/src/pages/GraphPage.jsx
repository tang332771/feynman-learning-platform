import { useEffect, useMemo, useState, useRef } from 'react';
import apiClient from '../api/axios';
import ReactECharts from 'echarts-for-react';
import { useNavigate } from 'react-router-dom';
import './GraphPage.css';

function GraphPage() {
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const chartRef = useRef(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await apiClient.get('/graph/knowledge-map');
        setGraphData(response.data);
      } catch (error) {
        console.error('获取图谱数据失败', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const option = useMemo(() => {
    const nodes = graphData.nodes || [];
    const links = graphData.links || [];

    // 简单的分类逻辑：根据状态或随机分配
    const categories = [
      { name: '已掌握', itemStyle: { color: '#10b981' } },
      { name: '学习中', itemStyle: { color: '#3b82f6' } },
      { name: '未开始', itemStyle: { color: '#94a3b8' } }
    ];

    const formattedNodes = nodes.map((n) => {
      const isMastered = n.status === 'mastered';
      // 简单的模拟状态逻辑，实际项目中应根据 n.status 判断
      const categoryIndex = isMastered ? 0 : (n.status === 'in_progress' ? 1 : 2); 
      
      return {
        id: String(n.id),
        name: n.name || n.title || String(n.id),
        value: n.value,
        category: categoryIndex,
        symbolSize: 30, // 固定大小或根据权重 (n.weight || 1) * 20 + 10
        draggable: true,
        label: {
          show: true,
          position: 'right',
          formatter: '{b}',
          color: '#cbd5e1' 
        }
      };
    });

    const formattedLinks = links.map(l => ({
      source: String(l.source),
      target: String(l.target),
      value: l.relation,
      lineStyle: {
        color: 'source',
        curveness: 0.3,
        opacity: 0.6
      }
    }));

    return {
      backgroundColor: 'transparent', // 让 CSS 控制背景
      tooltip: {
        trigger: 'item',
        formatter: (params) => {
          if (params.dataType === 'node') {
            return `<strong>${params.name}</strong><br/>状态: ${params.data.category === 0 ? '已掌握' : (params.data.category === 1 ? '学习中' : '未开始')}`;
          }
          return `${params.data.source} -> ${params.data.target}<br/>关系: ${params.data.value || '关联'}`;
        },
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        borderColor: '#334155',
        textStyle: { color: '#f8fafc' }
      },
      legend: {
        bottom: 20,
        data: categories.map(c => c.name),
        textStyle: {
          color: '#94a3b8'
        }
      },
      series: [
        {
          type: 'graph',
          layout: 'force',
          data: formattedNodes,
          links: formattedLinks,
          categories: categories,
          roam: true,
          label: {
            position: 'right',
            formatter: '{b}'
          },
          lineStyle: {
            color: 'source',
            curveness: 0.3
          },
          emphasis: {
            focus: 'adjacency',
            lineStyle: {
              width: 4
            }
          },
          force: {
            repulsion: 300,
            edgeLength: 150,
            gravity: 0.05,
            layoutAnimation: true
          }
        }
      ]
    };
  }, [graphData]);

  const onChartClick = (params) => {
    if (params.dataType === 'node') {
      navigate(`/kp/${params.data.id}`);
    }
  };

  return (
    <div className="graph-page-container">
      <div className="graph-header">
        <h1>知识图谱</h1>
        <p>可视化你的知识结构，点击节点查看详情。</p>
      </div>
      <div className="graph-chart-wrapper">
        {loading ? (
          <div className="loading-container">
            <div className="spinner"></div>
            <p>正在构建图谱...</p>
          </div>
        ) : (
          <ReactECharts
            ref={chartRef}
            option={option}
            style={{ height: '100%', width: '100%' }}
            onEvents={{
              'click': onChartClick
            }}
          />
        )}
      </div>
    </div>
  );
}

export default GraphPage;
