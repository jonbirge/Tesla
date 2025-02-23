// Settings
const LATLON_UPDATE_INTERVAL = 1; // seconds
const UPDATE_DISTANCE_THRESHOLD = 1000; // meters
const UPDATE_TIME_THRESHOLD = 60; // minutes
const NEWS_REFRESH_INTERVAL = 5; // minutes
const MAX_BUFFER_SIZE = 5;
const OPENWX_API_KEY = '6a1b1bcb03b5718a9b3a2b108ce3293d';
const GEONAMES_USERNAME = 'birgefuller';
const SAT_URLS = {
    latest: 'https://cdn.star.nesdis.noaa.gov/GOES16/GLM/CONUS/EXTENT3/1250x750.jpg',
    loop: 'https://cdn.star.nesdis.noaa.gov/GOES16/GLM/CONUS/EXTENT3/GOES16-CONUS-EXTENT3-625x375.gif',
    latest_ir: 'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/CONUS/11/1250x750.jpg',
};

// Global variables
let lastUpdate = 0;
let neverUpdatedLocation = true;
let lat = null;
let long = null;
let alt = null;
let lastUpdateLat = null;
let lastUpdateLong = null;
let sunrise = null;
let sunset = null;
let moonPhaseData = null;
let pingChart = null;
let pingInterval = null;
let pingData = [];
let manualDarkMode = false;
let darkOn = false;
let locationTimeZone = null;
let weatherData = null;
let forecastFetched = false;
let newsUpdateInterval = null;
let forecastData = null; // Add this with other global variables at the top
const locationBuffer = [];

class LocationPoint {
    constructor(lat, long, alt, timestamp) {
        this.lat = lat;
        this.long = long;
        this.alt = alt;
        this.timestamp = timestamp;
    }
}

function estimateSpeed(p1, p2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = p1.lat * Math.PI/180;
    const φ2 = p2.lat * Math.PI/180;
    const Δφ = (p2.lat - p1.lat) * Math.PI/180;
    const Δλ = (p2.long - p1.long) * Math.PI/180;

    // Haversine formula for distance
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const horizontalDist = R * c;

    // Add vertical component if altitude is available
    let verticalDist = 0;
    if (p1.alt != null && p2.alt != null) {
        verticalDist = p2.alt - p1.alt;
    }

    // Total 3D distance
    const distance = Math.sqrt(horizontalDist * horizontalDist + verticalDist * verticalDist);
    
    // Time difference in seconds
    const timeDiff = (p2.timestamp - p1.timestamp) / 1000;
    
    if (timeDiff === 0) return 0;
    
    // Speed in meters per second
    const speedMS = distance / timeDiff;
    // Convert to miles per hour
    return speedMS * 2.237; // 2.237 is the conversion factor from m/s to mph
}

function calculateHeading(p1, p2) {
    // Convert coordinates to radians
    const lat1 = p1.lat * Math.PI / 180;
    const lat2 = p2.lat * Math.PI / 180;
    const dLon = (p2.long - p1.long) * Math.PI / 180;

    // Calculate heading using great circle formula
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    let heading = Math.atan2(y, x) * 180 / Math.PI;
    
    // Normalize to 0-360°
    heading = (heading + 360) % 360;
    
    return heading;
}

function getCardinalDirection(heading) {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                       'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(heading * 16 / 360) % 16;
    return directions[index];
}

function toggleMode() {
    manualDarkMode = true;
    document.body.classList.toggle('dark-mode');
    darkOn = document.body.classList.contains('dark-mode');
    document.getElementById('darkModeToggle').checked = darkOn;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2 - lat1) * Math.PI/180;
    const Δλ = (lon2 - lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // returns distance in meters
}

function shouldUpdateLocationData() {
    if (neverUpdatedLocation || !lastUpdateLat || !lastUpdateLong) {
        return true;
    }

    const now = Date.now();
    const timeSinceLastUpdate = (now - lastUpdate) / (1000 * 60); // Convert to minutes
    const distance = calculateDistance(lat, long, lastUpdateLat, lastUpdateLong);
    
    return distance >= UPDATE_DISTANCE_THRESHOLD || timeSinceLastUpdate >= UPDATE_TIME_THRESHOLD;
}

function fetchCityData(lat, long) {
    // Proxy request to Geonames reverse geocoding API endpoint
    fetch(`https://secure.geonames.org/findNearbyPlaceNameJSON?lat=${lat}&lng=${long}&username=${GEONAMES_USERNAME}`)
        .then(response => response.json())
        .then(cityData => {
            const place = cityData.geonames && cityData.geonames[0];
            document.getElementById('city').innerText =
                (place ? (place.name || 'N/A') + ', ' + (place.adminName1 || 'N/A') : 'N/A');
        })
        .catch(error => {
            console.error('Error fetching city data:', error);
        });
}

async function fetchTimeZone(lat, long) {
    try {
        const response = await fetch(`https://secure.geonames.org/timezoneJSON?lat=${lat}&lng=${long}&username=${GEONAMES_USERNAME}`);
        const tzData = await response.json();
        return tzData.timezoneId || 'UTC';
    } catch (error) {
        console.error('Error fetching time zone:', error);
        return 'UTC';
    }
}

function fetchSunData(lat, long) {
    Promise.all([
        fetch(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${long}&formatted=0`),
        fetch(`https://api.farmsense.net/v1/moonphases/?d=${Math.floor(Date.now() / 1000)}`)
    ])
        .then(([sunResponse, moonResponse]) => Promise.all([sunResponse.json(), moonResponse.json()]))
        .then(([sunData, moonData]) => {
            // console.log('Sun data:', sunData);
            sunrise = sunData.results.sunrise;
            sunset = sunData.results.sunset;
            moonPhaseData = moonData[0];
            
            const sunriseElements = document.querySelectorAll('[id="sunrise"]');
            const sunsetElements = document.querySelectorAll('[id="sunset"]');
            const moonphaseElements = document.querySelectorAll('[id="moonphase"]');
            
            sunriseElements.forEach(element => {
                element.innerText = new Date(sunrise).toLocaleTimeString('en-US', {
                    timeZone: locationTimeZone || 'UTC',
                    timeZoneName: 'short'
                });
            });
            sunsetElements.forEach(element => {
                element.innerText = new Date(sunset).toLocaleTimeString('en-US', {
                    timeZone: locationTimeZone || 'UTC',
                    timeZoneName: 'short'
                });
            });
            moonphaseElements.forEach(element => {
                element.innerText = getMoonPhaseName(moonPhaseData.Phase);
            });
            
            // Automatically apply dark mode based on the local time
            updateAutoDarkMode();
        })
        .catch(error => {
            console.error('Error fetching sun/moon data: ', error);
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
            darkOn = true;
            document.getElementById('darkModeToggle').checked = true;
        } else {
            console.log('Applying light mode based on sunrise...');
            document.body.classList.remove('dark-mode');
            darkOn = false;
            document.getElementById('darkModeToggle').checked = false;
        }
    } else {
        console.log('Location not available for auto dark mode.');
    }
}

function updateNetworkInfo() {
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
            document.getElementById('exitLocation').innerText = `${ipData.city || 'N/A'}, ${ipData.region || 'N/A'}, ${ipData.country_name || 'N/A'}`;
            document.getElementById('isp').innerText = ipData.org || 'N/A';
        })
        .catch(error => {
            console.error('Error fetching IP/DNS information: ', error);
            // Set default values in case of error
            document.getElementById('rdns').innerText = 'N/A';
            document.getElementById('exitLocation').innerText = 'N/A';
            document.getElementById('isp').innerText = 'N/A';
        });
}

async function fetchWikipediaData(lat, long) {
    console.log('Fetching Wikipedia data...');
    const url = `https://secure.geonames.org/findNearbyWikipediaJSON?lat=${lat}&lng=${long}&username=birgefuller`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        const wikiDiv = document.getElementById('wikipediaInfo');
        if (data.geonames && data.geonames.length > 0) {
            let html = '<ul>';
            data.geonames.forEach(article => {
                // Ensure URL starts with http:// for proper linking
                const pageUrl = article.wikipediaUrl.startsWith('http') ? article.wikipediaUrl : 'http://' + article.wikipediaUrl;
                html += `<li><a href="${pageUrl}" target="_blank">${article.title}</a>: ${article.summary}</li>`;
            });
            html += '</ul>';
            wikiDiv.innerHTML = html;
        } else {
            wikiDiv.innerHTML = '<p><em>No nearby Wikipedia articles found.</em></p>';
        }
    } catch (error) {
        console.error('Error fetching Wikipedia data:', error);
        document.getElementById('wikipediaInfo').innerHTML = '<p><em>Error loading Wikipedia data.</em></p>';
    }
}

function startPingTest() {
    if (pingInterval) {
        // Stop existing test
        clearInterval(pingInterval);
        pingInterval = null;
        document.getElementById('pingTestButton').textContent = 'Restart Ping Test';
        return;
    }

    // Change button text immediately
    document.getElementById('pingTestButton').textContent = 'Stop Test';

    // Only clear data if this is a fresh start (not a restart)
    if (!pingData.length) {
        pingData = [];
        // Show the canvas
        document.getElementById('pingChart').style.display = 'block';

        // Get the Tesla blue color from CSS
        const teslaBlue = getComputedStyle(document.documentElement).getPropertyValue('--tesla-blue').trim();
        
        // Set colors based on dark mode
        const axisColor = darkOn ? '#808080' : 'var(--text-color)';
        
        // Initialize chart
        const ctx = document.getElementById('pingChart').getContext('2d');

        // Create gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, teslaBlue + '50');  // 25% opacity at top
        gradient.addColorStop(0.5, teslaBlue + '00');  // 0% opacity at bottom
        gradient.addColorStop(1, teslaBlue + '00');  // 0% opacity at bottom
        
        pingChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Ping (ms)',
                    data: pingData,
                    borderColor: teslaBlue,
                    borderWidth: 5,
                    fill: true,
                    backgroundColor: gradient,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                animation: true,
                scales: {
                    x: {
                        type: 'linear',
                        display: true,
                        grid: {
                            color: darkOn ? '#808080' : 'var(--separator-color)'
                        },
                        ticks: {
                            color: axisColor,
                            font: {
                                family: 'Inter',
                                size: 14,
                                weight: 600
                            }
                        },
                        title: {
                            display: true,
                            text: 'Elapsed Time (s)',
                            color: axisColor,
                            font: {
                                family: 'Inter',
                                size: 16,
                                weight: 600
                            }
                        }
                    },
                    y: {
                        display: true,
                        beginAtZero: true,
                        grid: {
                            color: darkOn ? '#808080' : 'var(--separator-color)'
                        },
                        ticks: {
                            color: axisColor,
                            font: {
                                family: 'Inter',
                                size: 14,
                                weight: 600
                            }
                        },
                        title: {
                            display: true,
                            text: 'Latency (ms)',
                            color: axisColor,
                            font: {
                                family: 'Inter',
                                size: 16,
                                weight: 600
                            }
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
    }

    // Start pinging
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
            if (pingData.length > 61) {
                pingData.shift(); // Keep last ~60 seconds
            }
            pingChart.data.labels = Array.from({ length: pingData.length }, (_, i) => i);
            pingChart.update('none'); // Update without animation for better performance
        })
        .catch(error => {
            console.error('Ping failed:', error);
        });
}

function switchWeatherImage(type) {
    const weatherImage = document.getElementById('weather-image');
    weatherImage.style.opacity = '0';
    
    setTimeout(() => {
        weatherImage.src = SAT_URLS[type];
        weatherImage.style.opacity = '1';
    }, 300);
    
    // Update buttons and slider position
    const weatherSwitch = document.querySelector('.weather-switch');
    const buttons = weatherSwitch.getElementsByTagName('button');
    buttons[0].classList.toggle('active', type === 'latest');
    buttons[1].classList.toggle('active', type === 'loop');
    buttons[2].classList.toggle('active', type === 'latest_ir');
    
    // Update slider position for three states
    const positions = { 'latest': 0, 'loop': 1, 'latest_ir': 2 };
    weatherSwitch.style.setProperty('--slider-position', positions[type]);
}

function fetchWeatherData(lat, long) {
    console.log('Fetching weather data...');
    Promise.all([
        fetch(`https://secure.geonames.org/findNearByWeatherJSON?lat=${lat}&lng=${long}&username=birgefuller`),
        !forecastFetched ? fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${long}&appid=${OPENWX_API_KEY}&units=imperial`) : Promise.resolve(null)
    ])
        .then(([currentResponse, forecastResponse]) => Promise.all([
            currentResponse.json(),
            forecastResponse ? forecastResponse.json() : null
        ]))
        .then(([currentData, forecastData]) => {
            if (currentData.weatherObservation) {
                weatherData = currentData.weatherObservation;
                updateWeatherDisplay();
            }
            
            if (forecastData && !forecastFetched) {
                updateForecastDisplay(forecastData);
                forecastFetched = true;
            }
        })
        .catch(error => {
            console.error('Error fetching weather data: ', error);
        });
}

function hasHazards(forecastData) {
    // Weather conditions that warrant an alert
    const hazardConditions = ['Rain', 'Snow', 'Sleet', 'Hail', 'Thunderstorm', 'Storm', 'Drizzle'];
    return forecastData.weather.some(w => 
        hazardConditions.some(condition => 
            w.main.includes(condition) || w.description.includes(condition.toLowerCase())
        )
    );
}

function updateForecastDisplay(data) {
    const forecastDays = document.querySelectorAll('.forecast-day');
    const dailyData = extractDailyForecast(data.list);
    
    dailyData.forEach((day, index) => {
        if (index < forecastDays.length) {
            const date = new Date(day.dt * 1000);
            const dayElement = forecastDays[index];
            
            // Clear previous content
            dayElement.innerHTML = '';
            
            // Add alert symbol if hazards detected
            if (hasHazards(day)) {
                const alert = document.createElement('div');
                alert.className = 'forecast-alert';
                alert.innerHTML = '⚠️';
                dayElement.appendChild(alert);
            }
            
            // Add the rest of the forecast content
            dayElement.innerHTML += `
                <div class="forecast-date">${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                <img class="forecast-icon" src="https://openweathermap.org/img/wn/${day.weather[0].icon}@2x.png" alt="${day.weather[0].description}">
                <div class="forecast-temp">${Math.round(day.temp_min)}°/${Math.round(day.temp_max)}°</div>
                <div class="forecast-desc">${day.weather[0].main}</div>
            `;
        }
    });
}

function extractDailyForecast(forecastList) {
    forecastData = forecastList;
    const dailyData = [];
    const dayMap = new Map();
    
    forecastList.forEach(item => {
        const date = new Date(item.dt * 1000).toDateString();
        
        if (!dayMap.has(date)) {
            dayMap.set(date, {
                dt: item.dt,
                temp_min: item.main.temp_min,
                temp_max: item.main.temp_max,
                weather: [item.weather[0]]  // Initialize weather array
            });
        } else {
            const existing = dayMap.get(date);
            existing.temp_min = Math.min(existing.temp_min, item.main.temp_min);
            existing.temp_max = Math.max(existing.temp_max, item.main.temp_max);
            // Add weather condition if it's not already included
            if (!existing.weather.some(w => w.main === item.weather[0].main)) {
                existing.weather.push(item.weather[0]);
            }
        }
    });
    
    dayMap.forEach(day => dailyData.push(day));
    return dailyData.slice(0, 5);
}

function showHourlyForecast(dayIndex) {
    if (!forecastData) return;

    const startDate = new Date(forecastData[0].dt * 1000).setHours(0, 0, 0, 0);
    const targetDate = new Date(startDate + dayIndex * 24 * 60 * 60 * 1000);
    const endDate = new Date(targetDate).setHours(23, 59, 59, 999);

    // Filter forecast data for the selected day
    const hourlyData = forecastData.filter(item => {
        const itemDate = new Date(item.dt * 1000);
        return itemDate >= targetDate && itemDate <= endDate;
    });

    // Create the popup content
    const popupDate = document.getElementById('popup-date');
    popupDate.textContent = targetDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
    });

    const hourlyContainer = document.querySelector('.hourly-forecast');
    hourlyContainer.innerHTML = hourlyData.map(item => {
        const time = new Date(item.dt * 1000).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit'
        });
        return `
            <div class="hourly-item">
                <div class="hourly-time">${time}</div>
                <img src="https://openweathermap.org/img/wn/${item.weather[0].icon}@2x.png" alt="${item.weather[0].description}" style="width: 50px; height: 50px;">
                <div class="hourly-temp">${Math.round(item.main.temp)}°F</div>
                <div class="hourly-desc">${item.weather[0].main}</div>
            </div>
        `;
    }).join('');

    // Show the popup and overlay
    document.querySelector('.overlay').classList.add('show');
    document.querySelector('.forecast-popup').classList.add('show');
}

function closeHourlyForecast() {
    document.querySelector('.overlay').classList.remove('show');
    document.querySelector('.forecast-popup').classList.remove('show');
}

function updateWeatherDisplay() {
    if (!weatherData) return;

    const windSpeedMS = weatherData.windSpeed;
    const windSpeedMPH = (windSpeedMS * 2.237).toFixed(1); // Convert m/s to mph
    const windDir = weatherData.windDirection;
    const humidity = weatherData.humidity;

    document.getElementById('humidity').innerText = `${humidity}%`;
    document.getElementById('wind').innerText = `${windSpeedMPH} mph at ${windDir}°`;
}

function loadExternalUrl(url, inFrame = false) {
    // Open external links in a new tab
    if (!inFrame) {
        window.open(url, '_blank');
        return;
    }

    // Load external content in the right frame
    const rightFrame = document.getElementById('rightFrame');
    
    // Store current content
    if (!rightFrame.hasAttribute('data-original-content')) {
        rightFrame.setAttribute('data-original-content', rightFrame.innerHTML);
    }
    
    // Create and load iframe
    rightFrame.innerHTML = '';
    rightFrame.classList.add('external');
    const iframe = document.createElement('iframe');
    iframe.setAttribute('allow', 'geolocation; fullscreen');
    iframe.src = url;
    rightFrame.appendChild(iframe);

    // Deactivate current section button
    const activeButton = document.querySelector('.section-button.active');
    if (activeButton) {
        activeButton.classList.remove('active');
    }
}

async function updateNews() {
    try {
        const response = await fetch('rss.php');
        const items = await response.json();
        
        const newsContainer = document.getElementById('newsHeadlines');
        if (!newsContainer) return;

        console.log('Updating news headlines...');

        const html = items.map(item => {
            const date = new Date(item.date * 1000);
            const timeString = date.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit',
                timeZoneName: 'short'
            });
            
            return `
                <button class="news-item" onclick="loadExternalUrl('${item.link}')">
                    <div>
                        <span class="news-source">${item.source.toUpperCase()}</span>
                        <span class="news-date">${timeString}</span>
                    </div>
                    <div class="news-title">${item.title}</div>
                </button>`;
        }).join('');

        newsContainer.innerHTML = html || '<p><em>No headlines available</em></p>';
    } catch (error) {
        console.error('Error fetching news:', error);
        document.getElementById('newsHeadlines').innerHTML = 
            '<p><em>Error loading headlines</em></p>';
    }
}

async function updateLocationData() {
    if (lat !== null && long !== null) {
        console.log('Updating location dependent data...');
        neverUpdatedLocation = false;

        // Fire off API requests for external data
        locationTimeZone = await fetchTimeZone(lat, long);
        console.log('Timezone: ', locationTimeZone);
        fetchCityData(lat, long);
        fetchSunData(lat, long);
        fetchWeatherData(lat, long);

        // Update connectivity data if the Network section is visible
        const networkSection = document.getElementById("network");
        if (networkSection.style.display === "block") {
            console.log('Updating connectivity data...');
            updateNetworkInfo();
        }

        // Update Wikipedia data if the Location section is visible
        const locationSection = document.getElementById("navigation");
        if (locationSection.style.display === "block") {
            console.log('Updating Wikipedia data...');
            fetchWikipediaData(lat, long);
        }
    } else {
        console.log('Location not available for dependent data.');
    }
}

function updateLatLong() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            lat = position.coords.latitude;
            long = position.coords.longitude;
            alt = position.coords.altitude;  // altitude in meters
            
            // Add new location point to buffer
            const newPoint = new LocationPoint(lat, long, alt, Date.now());
            locationBuffer.push(newPoint);
            if (locationBuffer.length > MAX_BUFFER_SIZE) {
                locationBuffer.shift(); // Remove oldest point
            }
            
            // Calculate speed and heading if we have enough points
            if (locationBuffer.length >= 2) {
                const oldestPoint = locationBuffer[0];
                const speed = estimateSpeed(oldestPoint, newPoint);
                const heading = calculateHeading(oldestPoint, newPoint);
                const cardinal = getCardinalDirection(heading);
                
                document.getElementById('speed').innerText = `${speed.toFixed(0)}`;
                document.getElementById('heading').innerText = `${heading.toFixed(0)}°`;
            }

            // Check if we should update location-dependent data
            if (shouldUpdateLocationData()) {
                console.log('Location changed significantly or time threshold reached, updating dependent data...');
                updateLocationData();
                lastUpdateLat = lat;
                lastUpdateLong = long;
                lastUpdate = Date.now();
            }
            
            document.getElementById('latitude').innerText = lat.toFixed(4) + '°';
            document.getElementById('longitude').innerText = long.toFixed(4) + '°';

            // Update altitude in feet
            if (alt) {
                const altFt = (alt * 3.28084).toFixed(0);
                document.getElementById('altitude-imperial').innerText = altFt;
            } else {
                document.getElementById('altitude-imperial').innerText = '--';
            }
        });
    } else {
        console.log('Geolocation is not supported by this browser.');
    }
}

// Get initial section from URL parameter
function getInitialSection() {
    const params = new URLSearchParams(window.location.search);
    return params.get('section') || 'news';  // default to navigation if no parameter
}

function showSection(sectionId) {
    // Log the clicked section
    console.log(`Showing section: ${sectionId}`);

    // Update URL without page reload 
    const url = new URL(window.location);
    url.searchParams.set('section', sectionId);
    window.history.pushState({}, '', url);

    // First, restore original content if we're in external mode
    const rightFrame = document.getElementById('rightFrame');
    if (rightFrame.classList.contains('external')) {
        rightFrame.innerHTML = rightFrame.getAttribute('data-original-content');
        rightFrame.removeAttribute('data-original-content');
        rightFrame.classList.remove('external');
    }

    // Then get a fresh reference to sections after DOM is restored
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

        if (sectionId === 'waze') {
            loadExternalUrl('https://teslawaze.azurewebsites.net/', true);
        }

        // Original section-specific logic
        if (sectionId === 'news') {
            // Only update news if interval is not set (first visit)
            if (!newsUpdateInterval) {
                updateNews();
                newsUpdateInterval = setInterval(updateNews, 60000 * NEWS_REFRESH_INTERVAL);
            }
        }
        
        // Load weather data for both weather and navigation sections
        if (sectionId === 'weather' || sectionId === 'navigation') {
            // Load latest weather data
            if (lat !== null && long !== null) {
                fetchWeatherData(lat, long);
            } else {
                console.log('Location not available to fetch weather data.');
            }
        }

        if (sectionId === 'satellite') {
            // Load weather image when satellite section is shown
            const weatherImage = document.getElementById('weather-image');
            weatherImage.src = SAT_URLS.latest;
        } else {
            // Remove weather img src to force reload when switching back
            const weatherImage = document.getElementById('weather-image');
            if (weatherImage) {
                weatherImage.src = '';
            }
        }

        if (sectionId === 'network') {
            updateNetworkInfo();
        }
        
        if (sectionId === 'navigation') {
            if (lat !== null && long !== null) {
                fetchWikipediaData(lat, long);
            } else {
                console.log('Location not available to fetch Wikipedia data.');
            }
        }
    }

    // Activate the clicked button
    const button = document.querySelector(`.section-button[onclick="showSection('${sectionId}')"]`);
    if (button) {
        button.classList.add('active');
    }
}

// ***** Main code *****

// Set up event listeners

// Update link click event listener
document.addEventListener('click', function(e) {
    if (e.target.tagName === 'A' && !e.target.closest('.section-buttons')) {
        e.preventDefault();
        const inFrame = e.target.hasAttribute('data-frame');
        loadExternalUrl(e.target.href, inFrame);
    }
});

// Add click handler to close popup when clicking overlay
document.querySelector('.overlay').addEventListener('click', closeHourlyForecast);

// Update location frequently but only trigger dependent updates when moved significantly
updateLatLong();
setInterval(updateLatLong, 1000*LATLON_UPDATE_INTERVAL);

// Show the initial section from URL parameter
showSection(getInitialSection());

// Handle browser back/forward buttons
window.addEventListener('popstate', () => {
    showSection(getInitialSection());
});
