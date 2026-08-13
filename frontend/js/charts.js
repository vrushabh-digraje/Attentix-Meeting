/**
 * FocusGuard Charts Manager
 * Configures and updates Chart.js charts for the host dashboard
 */

class DashboardCharts {
    static initTrendChart(canvasId) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        
        return new Chart(ctx, {
            type: 'line',
            data: {
                labels: [], // Timestamps
                datasets: [{
                    label: 'Avg Attention Score (%)',
                    data: [],
                    borderColor: '#06b6d4', // Cyan accent
                    backgroundColor: 'rgba(6, 182, 212, 0.05)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 2,
                    pointBackgroundColor: '#06b6d4'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8', font: { family: 'Outfit' } }
                    },
                    y: {
                        min: 0,
                        max: 100,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8', font: { family: 'Outfit' } }
                    }
                }
            }
        });
    }

    static initStateChart(canvasId) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        
        return new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Attentive', 'Distracted', 'Inactive'],
                datasets: [{
                    data: [0, 0, 0],
                    backgroundColor: [
                        '#10b981', // Green
                        '#f59e0b', // Yellow/Orange
                        '#ef4444'  // Red
                    ],
                    borderWidth: 1,
                    borderColor: '#0f172a' // Dark body background color
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#94a3b8',
                            font: { family: 'Outfit', size: 12 },
                            padding: 15
                        }
                    }
                },
                cutout: '70%'
            }
        });
    }

    static updateTrend(chart, timeLabel, avgValue) {
        chart.data.labels.push(timeLabel);
        chart.data.datasets[0].data.push(avgValue);
        
        // Keep maximum 20 data points on graph
        if (chart.data.labels.length > 20) {
            chart.data.labels.shift();
            chart.data.datasets[0].data.shift();
        }
        chart.update();
    }

    static updateStates(chart, attentive, distracted, inactive) {
        chart.data.datasets[0].data = [attentive, distracted, inactive];
        chart.update();
    }
}
