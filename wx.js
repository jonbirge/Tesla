// Global variables
let lastWxUpdate = 0;
let lastWxUpdateLat = null;
let lastWxUpdateLong = null;
let forecastData = null;
let weatherData = null;

// Mock weather data for test mode
function generateMockWeatherData() {
    return {
        temperature: 72,
        windSpeed: 6.7, // ~15 MPH when converted
        windDirection: 180, // From the north (will be flipped by 180° in updateWeatherDisplay)
        humidity: 45,
        weatherCondition: "Clear",
        stationName: "MOCK-STATION",
        datetime: new Date().toISOString()
    };
}

function generateMockForecastData() {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    
    // Create 5 days with different weather types
    const weatherTypes = [
        { main: "Clear", description: "clear sky", icon: "01d" },
        { main: "Rain", description: "moderate rain", icon: "10d" },
        { main: "Thunderstorm", description: "thunderstorm", icon: "11d" },
        { main: "Snow", description: "light snow", icon: "13d" },
        { main: "Clouds", description: "overcast clouds", icon: "04d" }
    ];
    
    const mockList = [];
    
    // For each day, create entries at 3-hour intervals
    for (let day = 0; day < 5; day++) {
        const dayType = weatherTypes[day];
        
        // Create 8 entries per day (3-hour intervals)
        for (let hour = 0; hour < 24; hour += 3) {
            const entryTime = now + (day * oneDayMs) + (hour * 60 * 60 * 1000);
            const tempVariation = Math.sin((hour / 24) * Math.PI) * 10;
            const baseTemp = 65 + (day * 2); // Slight temperature increase each day
            
            mockList.push({
                dt: Math.floor(entryTime / 1000),
                main: {
                    temp: baseTemp + tempVariation,
                    temp_min: baseTemp - 5 + tempVariation,
                    temp_max: baseTemp + 5 + tempVariation,
                    humidity: 45 + (day * 5)
                },
                weather: [{ 
                    id: 800 + (day * 100),
                    main: dayType.main, 
                    description: dayType.description,
                    icon: dayType.icon
                }]
            });
        }
    }
    
    return {
        list: mockList,
        city: {
            name: "Test City",
            country: "TC"
        }
    };
}

// Convert numerical phase to human-readable name
function getMoonPhaseName(phase) {
    if (phase === 0 || phase === 1) return "New Moon";
    if (phase < 0.25) return "Waxing Crescent";
    if (phase === 0.25) return "First Quarter";
    if (phase < 0.5) return "Waxing Gibbous";
    if (phase === 0.5) return "Full Moon";
    if (phase < 0.75) return "Waning Gibbous";
    if (phase === 0.75) return "Last Quarter";
    return "Waning Crescent";
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
    if (!lat || !long) {
        customLog('No location data available for weather fetch');
        return;
    }

    customLog('Fetching weather data...');

    if (testMode) {
        // Use mock data in test mode
        customLog('Using mock weather data (test mode)');
        weatherData = generateMockWeatherData();
        updateWeatherDisplay();

        const mockForecastData = generateMockForecastData();
        updateForecastDisplay(mockForecastData);

        lastWxUpdate = Date.now();
        lastWxUpdateLat = lat;
        lastWxUpdateLong = long;
        return;
    }

    Promise.all([
        fetch(`https://secure.geonames.org/findNearByWeatherJSON?lat=${lat}&lng=${long}&username=birgefuller`),
        fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${long}&appid=${OPENWX_API_KEY}&units=imperial`)
    ])
        .then(([currentResponse, forecastResponse]) => Promise.all([
            currentResponse.json(),
            forecastResponse ? forecastResponse.json() : null
        ]))
        .then(([currentData, forecastDataResponse]) => {
            if (currentData) {
                // check to see if wind direction is NaN
                if (isNaN(currentData.weatherObservation.windDirection)) {
                    currentData.weatherObservation.windDirection = null;
                    currentData.weatherObservation.windSpeed = null;
                } else {
                    // take the reciprocal of the wind direction to get the wind vector
                    currentData.weatherObservation.windDirection =
                        (currentData.weatherObservation.windDirection + 180) % 360;
                }
                weatherData = currentData.weatherObservation;
                updateWeatherDisplay();
            }

            if (forecastDataResponse) {
                updateForecastDisplay(forecastDataResponse);
            }

            lastWxUpdate = Date.now();
            lastWxUpdateLat = lat;
            lastWxUpdateLong = long;
        })
        .catch(error => {
            console.error('Error fetching weather data: ', error);
            customLog('Error fetching weather data: ', error);
        });
}

function hasHazards(forecastData) {
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
            
            // Clear previous content and classes
            dayElement.innerHTML = '';
            dayElement.className = 'forecast-day';
            
            // Add weather condition class based on main weather condition
            const weatherCondition = day.weather[0].main.toLowerCase();
            dayElement.classList.add(weatherCondition);
            
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
                weather: [item.weather[0]]
            });
        } else {
            const existing = dayMap.get(date);
            existing.temp_min = Math.min(existing.temp_min, item.main.temp_min);
            existing.temp_max = Math.max(existing.temp_max, item.main.temp_max);
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

    const hourlyData = forecastData.filter(item => {
        const itemDate = new Date(item.dt * 1000);
        return itemDate >= targetDate && itemDate <= endDate;
    });

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
        
        // Get weather condition class
        const weatherCondition = item.weather[0].main.toLowerCase();
        
        return `
            <div class="hourly-item ${weatherCondition}">
                <div class="hourly-time">${time}</div>
                <img src="https://openweathermap.org/img/wn/${item.weather[0].icon}@2x.png" alt="${item.weather[0].description}" style="width: 50px; height: 50px;">
                <div class="hourly-temp">${Math.round(item.main.temp)}°F</div>
                <div class="hourly-desc">${item.weather[0].main}</div>
            </div>
        `;
    }).join('');

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
    const windSpeedMPH = Math.min((windSpeedMS * 2.237), MAX_SPEED);
    const windDir = weatherData.windDirection;
    const humidity = weatherData.humidity;

    highlightUpdate('humidity', `${humidity}%`);
    if (windDir && windSpeedMPH) {
        highlightUpdate('wind',
            `${Math.round(windSpeedMPH)} mph at ${Math.round(windDir)}°`);
    } else {
        highlightUpdate('wind', '--');
    }

    // Get timestamp of weather data in local time
    const updateTime = new Date(Date.parse(weatherData.datetime + 'Z'));
    const wxUpdateTime = updateTime.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: locationTimeZone
    });

    // Get station name
    const stationName = weatherData.stationName || '';

    // Update station information
    const stationInfoStr = stationName + ' @ ' + wxUpdateTime;
    highlightUpdate('station-info', stationInfoStr);

    // Update weather update time with current time
    const currentTime = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: locationTimeZone
    });
    highlightUpdate('wx-update', currentTime);
}

function fetchSunData(lat, long) {
    if (!lat || !long) {
        customLog('No location data available for sun/moon fetch');
        return;
    }

    Promise.all([
        fetch(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${long}&formatted=0`),
        fetch(`https://api.farmsense.net/v1/moonphases/?d=${Math.floor(Date.now() / 1000)}`)
    ])
        .then(([sunResponse, moonResponse]) => Promise.all([sunResponse.json(), moonResponse.json()]))
        .then(([sunData, moonData]) => {
            sunrise = sunData.results.sunrise;
            sunset = sunData.results.sunset;
            moonPhaseData = moonData[0];
            
            const moonphaseElements = document.querySelectorAll('[id="moonphase"]');
            
            const sunriseTime = new Date(sunrise).toLocaleTimeString('en-US', {
                timeZone: locationTimeZone,
                timeZoneName: 'short'
            });
            highlightUpdate('sunrise', sunriseTime);

            const sunsetTime = new Date(sunset).toLocaleTimeString('en-US', {
                timeZone: locationTimeZone,
                timeZoneName: 'short'
            });
            highlightUpdate('sunset', sunsetTime);

            const moonPhase = getMoonPhaseName(moonPhaseData.Phase);
            highlightUpdate('moonphase', moonPhase);
            
            updateAutoDarkMode();
        })
        .catch(error => {
            console.error('Error fetching sun/moon data: ', error);
            customLog('Error fetching sun/moon data: ', error);
        });
}

// Update Wx data if more than 30 minutes since the last update
// OR if we've moved more than a certain distance since the last update
function shouldUpdateWeatherData() {
    // Check if we've never updated weather data
    if (lastWxUpdate === 0 || lastWxUpdateLat === null || lastWxUpdateLong === null) {
        return true;
    }
    
    // Check time threshold using WX_TIME_THRESHOLD constant
    const now = Date.now();
    const timeSinceLastUpdate = now - lastWxUpdate;
    if (timeSinceLastUpdate >= WX_TIME_THRESHOLD * 60 * 1000) { // Convert minutes to milliseconds
        return true;
    }
    
    // Check distance threshold using WX_DISTANCE_THRESHOLD constant
    if (lat !== null && long !== null) {
        const distance = calculateDistance(lat, long, lastWxUpdateLat, lastWxUpdateLong);
        if (distance >= WX_DISTANCE_THRESHOLD) { // Use constant for meters
            return true;
        }
    }
    
    // No need to update weather data
    return false;
}
