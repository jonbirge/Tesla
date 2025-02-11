let lastUpdate = 0;
let lat = null;
let long = null;
let sunrise = null;
let sunset = null;
let moonPhaseData = null;
let manualDarkMode = false;
let pingChart = null;
let pingInterval = null;
let pingData = [];

function toggleMode() {
    manualDarkMode = true;
    document.body.classList.toggle('dark-mode');
    document.getElementById('darkModeToggle').checked = document.body.classList.contains('dark-mode');
}

function updateLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            lat = position.coords.latitude;
            long = position.coords.longitude;
            console.log(`Location updated: ${lat}, ${long}`);

            // Update location display
            document.getElementById('latitude').innerText = lat.toFixed(4) + '°';
            document.getElementById('longitude').innerText = long.toFixed(4) + '°';
            
            // Update local weather link
            const weatherLink = document.getElementById('localWeather');
            if (weatherLink) {
                weatherLink.href = `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${long}`;
            }

            // If the Connectivity section is visible, update the IP data
            const connectivitySection = document.getElementById('connectivity');
            if (connectivitySection.style.display === 'block') {
                updateConnectionInfo();
            }

            // Fire off async API requests for external data
            fetchCityData(lat, long);
            fetchSunData(lat, long);
        });
    } else {
        console.log('Geolocation is not supported by this browser.');
    }
}

function fetchCityData(lat, long) {
    fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${long}&localityLanguage=en`)
        .then(response => response.json())
        .then(cityData => {
            document.getElementById('city').innerText =
                (cityData.locality || 'N/A') + ', ' +
                (cityData.principalSubdivision || 'N/A');
        })
        .catch(error => {
            console.error('Error fetching city data:', error);
        });
}

function fetchSunData(lat, long) {
    Promise.all([
        fetch(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${long}&formatted=0`),
        fetch(`https://api.farmsense.net/v1/moonphases/?d=${Math.floor(Date.now() / 1000)}`)
    ])
        .then(([sunResponse, moonResponse]) => Promise.all([sunResponse.json(), moonResponse.json()]))
        .then(([sunData, moonData]) => {
            sunrise = sunData.results.sunrise;
            sunset = sunData.results.sunset;
            moonPhaseData = moonData[0];
            
            document.getElementById('sunrise').innerText = new Date(sunrise).toLocaleTimeString();
            document.getElementById('sunset').innerText = new Date(sunset).toLocaleTimeString();
            document.getElementById('moonphase').innerText = getMoonPhaseName(moonPhaseData.Phase);
            
            // Automatically apply dark mode based on the local time
            updateAutoDarkMode();
        })
        .catch(error => {
            console.error('Error fetching sun/moon data:', error);
        });
}

function getMoonPhaseName(phase) {
    // Convert numerical phase to human-readable name
    if (phase === 0 || phase === 1) return "New Moon";
    if (phase < 0.25) return "Waxing Crescent";
    if (phase === 0.25) return "First Quarter";
    if (phase < 0.5) return "Waxing Gibbous";
    if (phase === 0.5) return "Full Moon";
    if (phase < 0.75) return "Waning Gibbous";
    if (phase === 0.75) return "Last Quarter";
    return "Waning Crescent";
}

function updateAutoDarkMode() {
    if (!manualDarkMode && lat !== null && long !== null) {
        const now = new Date();
        const currentTime = now.getTime();
        const sunriseTime = new Date(sunrise).getTime();
        const sunsetTime = new Date(sunset).getTime();

        if (currentTime >= sunsetTime || currentTime < sunriseTime) {
            console.log('Applying dark mode based on sunset...');
            document.body.classList.add('dark-mode');
            document.getElementById('darkModeToggle').checked = true;
        } else {
            console.log('Applying light mode based on sunrise...');
            document.body.classList.remove('dark-mode');
            document.getElementById('darkModeToggle').checked = false;
        }
    } else {
        console.log('Location not available for auto dark mode.');
    }
}

function updateConnectionInfo() {
    // Write diagnostic information to the console
    console.log('Updating connection info...');

    // Get detailed IP info from ipapi.co
    fetch('https://ipapi.co/json/')
        .then(response => response.json())
        .then(ipData => {
            // Get reverse DNS using Google's public DNS API
            const ip = ipData.ip;
            // Reverse the IP address and fetch the PTR record
            const revIp = ip.split('.').reverse().join('.');
            
            return Promise.all([
                Promise.resolve(ipData),
                fetch(`https://dns.google.com/resolve?name=${revIp}.in-addr.arpa&type=PTR`)
                    .then(response => response.json())
            ]);
        })
        .then(([ipData, dnsData]) => {
            // Get the PTR record if it exists
            const rdnsName = dnsData.Answer ? dnsData.Answer[0].data : ipData.ip;

            // Update the UI with the fetched data
            document.getElementById('rdns').innerText = rdnsName;
            document.getElementById('location').innerText = `${ipData.city || 'N/A'}, ${ipData.region || 'N/A'}, ${ipData.country_name || 'N/A'}`;
            document.getElementById('isp').innerText = ipData.org || 'N/A';
        })
        .catch(error => {
            console.error('Error fetching IP/DNS information: ', error);
            // Set default values in case of error
            document.getElementById('rdns').innerText = 'N/A';
            document.getElementById('location').innerText = 'N/A';
            document.getElementById('isp').innerText = 'N/A';
        });
}

function showSection(sectionId) {
    // Log the clicked section
    console.log(`Showing section: ${sectionId}`);

    // Hide all sections
    const sections = document.querySelectorAll('.section');
    sections.forEach(section => {
        section.style.display = 'none';
    });

    // Deactivate all buttons
    const buttons = document.querySelectorAll('.section-button');
    buttons.forEach(button => {
        button.classList.remove('active');
    });

    // Show the selected section
    const section = document.getElementById(sectionId);
    if (section) {
        section.style.display = 'block';
    }

    // Activate the clicked button
    const button = document.querySelector(`.section-button[onclick="showSection('${sectionId}')"]`);
    if (button) {
        button.classList.add('active');
    }

    // Handle special cases
    if (sectionId === 'connectivity') {
        const now = Date.now();
        if (now - lastUpdate > 60000) { // 60 seconds
            updateConnectionInfo();
            lastUpdate = now;
        } else {
            console.log('Skipping update, too soon...');
        }
    }
}

function startPingTest() {
    if (pingInterval) {
        // Stop existing test
        clearInterval(pingInterval);
        pingInterval = null;
        document.getElementById('pingTestButton').textContent = 'Start Ping Test';
        return;
    }

    // Clear previous data
    pingData = [];
    
    // Initialize chart
    const ctx = document.getElementById('pingChart').getContext('2d');
    pingChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Ping (ms)',
                data: pingData,
                borderColor: 'var(--tesla-blue)',
                borderWidth: 1,
                fill: false,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            animation: false,
            scales: {
                x: {
                    type: 'linear',
                    display: true,
                    grid: {
                        color: 'var(--separator-color)'
                    },
                    ticks: {
                        color: 'var(--text-color)'
                    }
                },
                y: {
                    display: true,
                    beginAtZero: true,
                    grid: {
                        color: 'var(--separator-color)'
                    },
                    ticks: {
                        color: 'var(--text-color)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });

    // Start pinging
    document.getElementById('pingTestButton').textContent = 'Stop Test';
    pingInterval = setInterval(pingTestServer, 1000);
}

function pingTestServer() {
    const startTime = performance.now();
    fetch('ping.php', { 
        cache: 'no-store',
        method: 'HEAD'  // Only get headers, we don't need content
    })
        .then(() => {
            const pingTime = performance.now() - startTime;
            pingData.push(pingTime);
            if (pingData.length > 60) {
                pingData.shift(); // Keep last 60 seconds
            }
            
            pingChart.data.labels = Array.from({ length: pingData.length }, (_, i) => i);
            pingChart.update('none'); // Update without animation for better performance
        })
        .catch(error => {
            console.error('Ping failed:', error);
        });
}

// Update location on page load and every minute thereafter
updateLocation();
setInterval(updateLocation, 60000);

// Show the first section by default
showSection('news');
