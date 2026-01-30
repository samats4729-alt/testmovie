const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
// SEO: Dynamic Meta Tags for Watch Page
app.get('/watch/:id', async (req, res) => {
    const id = req.params.id;
    const movie = await getMovie(id);

    // Read html template
    fs.readFile(path.join(__dirname, 'public', 'watch.html'), 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send('Error loading page');
        }

        // Default metadata
        let title = 'Смотреть онлайн — CINEMATIC';
        let description = 'Смотрите лучшие фильмы и сериалы в премиум качестве бесплатно.';
        let image = 'https://cinematic.site/assets/og-image.jpg';
        let url = `https://cinematic.site/watch/${id}`;

        if (movie && movie.title) {
            title = `${movie.title} — смотреть онлайн бесплатно в 4K | CINEMATIC`;
            description = `Смотреть фильм ${movie.title} (${movie.year}) онлайн в хорошем качестве. ${movie.description ? movie.description.substring(0, 150) + '...' : ''}`;
            if (movie.poster) image = movie.poster;
        }

        // Replace placeholders
        const html = data
            .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
            .replace(/content="{{OG_TITLE}}"/g, `content="${title}"`)
            .replace(/content="{{OG_DESCRIPTION}}"/g, `content="${description.replace(/"/g, '&quot;')}"`)
            .replace(/content="{{OG_IMAGE}}"/g, `content="${image}"`)
            .replace(/content="{{OG_URL}}"/g, `content="${url}"`)
            .replace(/name="description" content=".*?"/, `name="description" content="${description.replace(/"/g, '&quot;')}"`)
            // JSON-LD Schema
            .replace('</head>', `
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Movie",
      "name": "${movie.title.replace(/"/g, '\\"')}",
      "image": "${image}",
      "description": "${description.replace(/"/g, '\\"')}",
      "datePublished": "${movie.year}",
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": "${movie.rating || 0}",
        "bestRating": "10",
        "ratingCount": "${movie.votes || 0}"
      }
    }
    </script>
</head>`);

        res.send(html);
    });
});

app.get('/sitemap.xml', (req, res) => {
    const db = loadDatabase();
    const domain = 'https://cinematic.site';
    const movies = Object.values(db.movies);

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url>
            <loc>${domain}/</loc>
            <changefreq>daily</changefreq>
            <priority>1.0</priority>
        </url>
        <url>
            <loc>${domain}/movies</loc>
            <changefreq>daily</changefreq>
            <priority>0.8</priority>
        </url>
    `;

    movies.forEach(movie => {
        xml += `
        <url>
            <loc>${domain}/watch/${movie.id}</loc>
            <lastmod>${movie.cachedAt ? movie.cachedAt.split('T')[0] : new Date().toISOString().split('T')[0]}</lastmod>
            <changefreq>weekly</changefreq>
            <priority>0.7</priority>
        </url>`;
    });

    xml += '</urlset>';

    res.header('Content-Type', 'application/xml');
    res.send(xml);
});

app.use(express.static(path.join(__dirname, 'public')));

// ================== ONLINE USERS TRACKING ==================
const onlineUsers = new Map(); // sessionId -> lastActivity timestamp
const ONLINE_TIMEOUT = 60000; // 60 секунд без активности = офлайн

// Очистка неактивных пользователей каждые 30 сек
setInterval(() => {
    const now = Date.now();
    for (const [sessionId, lastActivity] of onlineUsers.entries()) {
        if (now - lastActivity > ONLINE_TIMEOUT) {
            onlineUsers.delete(sessionId);
        }
    }
}, 30000);

// API: Heartbeat — обновляем статус пользователя
app.post('/api/online/heartbeat', (req, res) => {
    const sessionId = req.body.sessionId || req.ip;
    onlineUsers.set(sessionId, Date.now());
    res.json({ success: true, online: onlineUsers.size });
});

// API: Получить количество онлайн
app.get('/api/online/count', (req, res) => {
    res.json({ online: onlineUsers.size });
});

// ================== ADMIN PANEL ==================

// Paths
const SITES_DB_PATH = path.join(__dirname, 'data', 'sites.json');
const ADMIN_CONFIG_PATH = path.join(__dirname, 'data', 'admin.json');

// Admin credentials (можно изменить)
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'cinema2024';
const JWT_SECRET = 'cinematic-admin-secret-key-2024';

// Initialize sites database
function initSitesDB() {
    if (!fs.existsSync(SITES_DB_PATH)) {
        fs.writeFileSync(SITES_DB_PATH, JSON.stringify({ sites: {} }, null, 2));
    }
}

// Load sites
function loadSites() {
    initSitesDB();
    try {
        return JSON.parse(fs.readFileSync(SITES_DB_PATH, 'utf-8'));
    } catch {
        return { sites: {} };
    }
}

// Save sites
function saveSites(data) {
    fs.writeFileSync(SITES_DB_PATH, JSON.stringify(data, null, 2));
}

// Generate API key
function generateApiKey() {
    return 'ck_' + [...Array(32)].map(() => Math.random().toString(36)[2]).join('');
}

// Generate site ID
function generateSiteId() {
    return 'site_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// Simple JWT-like token
function generateToken(username) {
    const payload = { user: username, exp: Date.now() + 24 * 60 * 60 * 1000 }; // 24 hours
    return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function verifyToken(token) {
    try {
        const payload = JSON.parse(Buffer.from(token, 'base64').toString());
        return payload.exp > Date.now() ? payload : null;
    } catch {
        return null;
    }
}

// Auth middleware
function adminAuth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token || !verifyToken(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// API key auth for sites
function siteAuth(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    const siteId = req.params.siteId;
    const db = loadSites();

    if (!db.sites[siteId] || db.sites[siteId].apiKey !== apiKey) {
        return res.status(401).json({ error: 'Invalid API key' });
    }
    req.site = db.sites[siteId];
    next();
}

// ===== ADMIN AUTH =====

// Login
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        const token = generateToken(username);
        res.json({ success: true, token });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// Check auth
app.get('/api/admin/check', adminAuth, (req, res) => {
    res.json({ success: true, user: 'admin' });
});

// ===== SITES MANAGEMENT =====

// Get all sites
app.get('/api/admin/sites', adminAuth, (req, res) => {
    const db = loadSites();
    const sites = Object.values(db.sites).map(site => ({
        ...site,
        apiKey: site.apiKey.substring(0, 8) + '...' // Hide full key
    }));
    res.json({ success: true, sites });
});

// Register new site
app.post('/api/admin/sites', adminAuth, (req, res) => {
    const { name, domain } = req.body;

    if (!name || !domain) {
        return res.status(400).json({ error: 'Name and domain required' });
    }

    const db = loadSites();
    const siteId = generateSiteId();
    const apiKey = generateApiKey();

    db.sites[siteId] = {
        siteId,
        name,
        domain,
        apiKey,
        status: 'offline',
        lastHeartbeat: null,
        stats: {
            onlineNow: 0,
            viewsToday: 0,
            viewsTotal: 0
        },
        createdAt: new Date().toISOString()
    };

    saveSites(db);

    res.json({
        success: true,
        site: db.sites[siteId]
    });
});

// Get single site (full details)
app.get('/api/admin/sites/:siteId', adminAuth, (req, res) => {
    const db = loadSites();
    const site = db.sites[req.params.siteId];

    if (!site) {
        return res.status(404).json({ error: 'Site not found' });
    }

    res.json({ success: true, site });
});

// Delete site
app.delete('/api/admin/sites/:siteId', adminAuth, (req, res) => {
    const db = loadSites();

    if (!db.sites[req.params.siteId]) {
        return res.status(404).json({ error: 'Site not found' });
    }

    delete db.sites[req.params.siteId];
    saveSites(db);

    res.json({ success: true });
});

// ===== SITE API (for mirrors) =====

// Heartbeat from mirror site
app.post('/api/admin/sites/:siteId/heartbeat', siteAuth, (req, res) => {
    const { online, views } = req.body;
    const db = loadSites();
    const site = db.sites[req.params.siteId];

    site.status = 'online';
    site.lastHeartbeat = new Date().toISOString();
    site.stats.onlineNow = online || 0;

    if (views) {
        site.stats.viewsToday += views;
        site.stats.viewsTotal += views;
    }

    saveSites(db);

    res.json({ success: true });
});

// Stats from mirror site
app.post('/api/admin/sites/:siteId/stats', siteAuth, (req, res) => {
    const { views, events } = req.body;
    const db = loadSites();
    const site = db.sites[req.params.siteId];

    if (views) {
        site.stats.viewsTotal = views;
    }

    saveSites(db);

    res.json({ success: true });
});

// ===== GLOBAL STATS =====

app.get('/api/admin/stats', adminAuth, (req, res) => {
    const db = loadSites();
    const sites = Object.values(db.sites);

    const totalOnline = sites.reduce((sum, s) => sum + (s.stats.onlineNow || 0), 0);
    const totalViewsToday = sites.reduce((sum, s) => sum + (s.stats.viewsToday || 0), 0);
    const totalViewsAll = sites.reduce((sum, s) => sum + (s.stats.viewsTotal || 0), 0);
    const onlineSites = sites.filter(s => s.status === 'online').length;

    res.json({
        success: true,
        stats: {
            totalSites: sites.length,
            onlineSites,
            totalOnlineUsers: totalOnline,
            viewsToday: totalViewsToday,
            viewsTotal: totalViewsAll
        }
    });
});

// Check site status (mark offline if no heartbeat for 2 min)
setInterval(() => {
    const db = loadSites();
    const now = Date.now();
    let changed = false;

    for (const site of Object.values(db.sites)) {
        if (site.lastHeartbeat) {
            const lastBeat = new Date(site.lastHeartbeat).getTime();
            if (now - lastBeat > 120000 && site.status === 'online') {
                site.status = 'offline';
                site.stats.onlineNow = 0;
                changed = true;
            }
        }
    }

    if (changed) saveSites(db);
}, 60000);

// Admin page route
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Локальная база данных фильмов
const DB_PATH = path.join(__dirname, 'data', 'movies.json');
const CACHE_PATH = path.join(__dirname, 'data', 'cache.json');

// API ключи (скрыты от пользователей)
const API_KEY = '8c8e1a50-6322-4135-8875-5d40a5420d86';
const API_BASE = 'https://kinopoiskapiunofficial.tech/api/v2.2/films';

// Инициализация базы данных
function initDatabase() {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ movies: {}, lastUpdate: null }, null, 2));
    }

    if (!fs.existsSync(CACHE_PATH)) {
        fs.writeFileSync(CACHE_PATH, JSON.stringify({ searches: {}, top: null }, null, 2));
    }
}

// Загрузка базы
function loadDatabase() {
    try {
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch {
        return { movies: {}, lastUpdate: null };
    }
}

// Сохранение в базу
function saveToDatabase(id, movieData) {
    const db = loadDatabase();
    db.movies[id] = {
        ...movieData,
        cachedAt: new Date().toISOString()
    };
    db.lastUpdate = new Date().toISOString();
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// Получить из базы
function getFromDatabase(id) {
    const db = loadDatabase();
    return db.movies[id] || null;
}

// Трансформация данных (убираем следы источника)
function transformMovieData(apiData, id) {
    // Фильтруем заглушки Кинопоиска
    const filterPoster = (url) => {
        if (!url) return null;
        if (url.includes('no-poster')) return null; // Кинопоиск заглушка
        return url;
    };

    return {
        id: id,
        title: apiData.nameRu || apiData.nameOriginal || `Фильм`,
        originalTitle: apiData.nameOriginal || apiData.nameEn,
        year: apiData.year,
        description: apiData.description || apiData.shortDescription || '',
        poster: filterPoster(apiData.posterUrl),
        posterPreview: filterPoster(apiData.posterUrlPreview),
        backdrop: filterPoster(apiData.coverUrl) || filterPoster(apiData.posterUrl),
        rating: apiData.ratingKinopoisk || apiData.ratingImdb,
        ratingImdb: apiData.ratingImdb,
        votes: apiData.ratingKinopoiskVoteCount,
        duration: apiData.filmLength,
        genres: apiData.genres?.map(g => g.genre) || [],
        countries: apiData.countries?.map(c => c.country) || [],
        ageRating: apiData.ratingAgeLimits?.replace('age', '') || null,
        type: apiData.type === 'TV_SERIES' ? 'series' : 'movie',
        slogan: apiData.slogan,
        // Плеер URL (без указания источника)
        streamUrl: `/watch/${id}`
    };
}

// Получить фильм (сначала из кеша, потом API)
async function getMovie(id, forceFullData = false) {
    // Проверяем локальную базу
    const cached = getFromDatabase(id);

    // Если есть полные данные (с описанием), возвращаем из кеша
    if (cached && cached.description && !forceFullData) {
        console.log(`📦 [CACHE] Фильм ${id} из локальной базы`);
        return cached;
    }

    // Запрос к API за полными данными
    try {
        console.log(`🌐 [API] Загружаем полные данные фильма ${id}...`);
        const response = await fetch(`${API_BASE}/${id}`, {
            headers: {
                'X-API-KEY': API_KEY,
                'Content-Type': 'application/json',
            }
        });

        if (response.ok) {
            const apiData = await response.json();
            const movie = transformMovieData(apiData, id);

            // Сохраняем в локальную базу
            saveToDatabase(id, movie);
            console.log(`✅ [SAVED] Фильм ${id} сохранён в базу (с описанием)`);

            return movie;
        }
    } catch (error) {
        console.error(`❌ [ERROR] Ошибка загрузки фильма ${id}:`, error.message);
    }

    // Возвращаем кешированные данные или минимальные
    return cached || {
        id: id,
        title: `Фильм`,
        streamUrl: `/watch/${id}`
    };
}

// Поиск фильмов
async function searchMovies(query) {
    try {
        const response = await fetch(
            `${API_BASE}?keyword=${encodeURIComponent(query)}&page=1`,
            {
                headers: {
                    'X-API-KEY': API_KEY,
                    'Content-Type': 'application/json',
                }
            }
        );

        if (response.ok) {
            const data = await response.json();
            const movies = data.items?.slice(0, 20).map(film => ({
                id: film.kinopoiskId,
                title: film.nameRu || film.nameOriginal,
                originalTitle: film.nameOriginal,
                year: film.year,
                poster: film.posterUrlPreview,
                rating: film.ratingKinopoisk || film.ratingImdb,
                genres: film.genres?.map(g => g.genre) || []
            })) || [];

            // Сохраняем найденные фильмы в базу (базовые данные)
            movies.forEach(m => {
                if (!getFromDatabase(m.id)) {
                    saveToDatabase(m.id, m);
                }
            });

            return movies;
        }
    } catch (error) {
        console.error('Search error:', error.message);
    }

    return [];
}

// Получить топ фильмов
async function getTopMovies() {
    try {
        const response = await fetch(
            `https://kinopoiskapiunofficial.tech/api/v2.2/films/collections?type=TOP_POPULAR_MOVIES&page=1`,
            {
                headers: {
                    'X-API-KEY': API_KEY,
                    'Content-Type': 'application/json',
                }
            }
        );

        if (response.ok) {
            const data = await response.json();
            const movies = data.items?.slice(0, 18).map(film => ({
                id: film.kinopoiskId,
                title: film.nameRu || film.nameOriginal,
                year: film.year,
                poster: film.posterUrlPreview,
                rating: film.ratingKinopoisk || film.ratingImdb,
                genres: film.genres?.map(g => g.genre) || []
            })) || [];

            // Кешируем все в базу
            movies.forEach(m => {
                if (!getFromDatabase(m.id)) {
                    saveToDatabase(m.id, m);
                }
            });

            return movies;
        }
    } catch (error) {
        console.error('Top movies error:', error.message);
    }

    // Возвращаем из локальной базы если API недоступен
    const db = loadDatabase();
    return Object.values(db.movies).slice(0, 18);
}

// Предзагрузка популярных фильмов
async function preloadPopularMovies() {
    console.log('📥 Предзагрузка популярных фильмов...');

    const popularIds = [
        447301,  // Начало
        258687,  // Интерстеллар
        526875,  // Выживший
        1143242, // Дюна 2
        435,     // Зелёная миля
        329,     // Список Шиндлера
        3498,    // Властелин колец
        41520,   // Брат 2
        32898,   // Достучаться до небес
        342,     // Криминальное чтиво
        519,     // Человек дождя
        301,     // Матрица
    ];

    for (const id of popularIds) {
        const cached = getFromDatabase(id);
        // Загружаем если нет в кеше или нет описания
        if (!cached || !cached.description) {
            await getMovie(id);
            await new Promise(r => setTimeout(r, 300));
        }
    }

    console.log('✅ Предзагрузка завершена');
}

// Обогащение базы описаниями (запускается при старте)
async function enrichMoviesWithDescriptions() {
    const db = loadDatabase();
    const movies = Object.values(db.movies);
    const withoutDescription = movies.filter(m => !m.description);

    if (withoutDescription.length === 0) {
        console.log('✅ Все фильмы уже имеют описания');
        return;
    }

    console.log(`📝 Обогащаем ${withoutDescription.length} фильмов описаниями...`);

    let enriched = 0;
    for (const movie of withoutDescription.slice(0, 50)) { // Лимит 50 за раз
        try {
            await getMovie(movie.id);
            enriched++;
            await new Promise(r => setTimeout(r, 350)); // Задержка для API
        } catch (e) {
            console.error(`Ошибка обогащения ${movie.id}:`, e.message);
        }
    }

    console.log(`✅ Обогащено ${enriched} фильмов описаниями`);
}

// ================== API ROUTES ==================

// Получить фильм
app.get('/api/movie/:id', async (req, res) => {
    const id = req.params.id.match(/(\d+)/)?.[1];
    if (!id) {
        return res.status(400).json({ success: false, error: 'Invalid ID' });
    }

    const movie = await getMovie(id);
    res.json({ success: true, movie });
});

// Поиск
app.get('/api/search', async (req, res) => {
    const query = req.query.q;
    if (!query) {
        return res.status(400).json({ success: false, error: 'Query required' });
    }

    const movies = await searchMovies(query);
    res.json({ success: true, movies });
});

// Топ фильмов (с пагинацией)
app.get('/api/top', async (req, res) => {
    const page = parseInt(req.query.page) || 1;

    try {
        const response = await fetch(
            `https://kinopoiskapiunofficial.tech/api/v2.2/films/collections?type=TOP_POPULAR_MOVIES&page=${page}`,
            {
                headers: {
                    'X-API-KEY': API_KEY,
                    'Content-Type': 'application/json',
                }
            }
        );

        if (response.ok) {
            const data = await response.json();
            const movies = data.items?.map(film => ({
                id: film.kinopoiskId,
                title: film.nameRu || film.nameOriginal,
                year: film.year,
                poster: film.posterUrlPreview,
                rating: film.ratingKinopoisk || film.ratingImdb,
                genres: film.genres?.map(g => g.genre) || []
            })) || [];

            movies.forEach(m => {
                if (!getFromDatabase(m.id)) saveToDatabase(m.id, m);
            });

            return res.json({
                success: true,
                movies,
                page,
                totalPages: data.totalPages || 20,
                hasMore: page < (data.totalPages || 20)
            });
        }
    } catch (error) {
        console.error('Top movies error:', error.message);
    }

    const db = loadDatabase();
    const allMovies = Object.values(db.movies);
    const perPage = 20;
    const start = (page - 1) * perPage;

    res.json({
        success: true,
        movies: allMovies.slice(start, start + perPage),
        page,
        totalPages: Math.ceil(allMovies.length / perPage),
        hasMore: start + perPage < allMovies.length
    });
});

// Коллекции
app.get('/api/collections', async (req, res) => {
    const db = loadDatabase();
    const allMovies = Object.values(db.movies);

    res.json({
        success: true,
        collections: {
            popular: allMovies.filter(m => m.rating >= 8).slice(0, 12),
            new: allMovies.filter(m => m.year >= 2023).slice(0, 12),
            classic: allMovies.filter(m => m.year < 2000).slice(0, 12)
        }
    });
});

// Статистика базы
app.get('/api/stats', (req, res) => {
    const db = loadDatabase();
    res.json({
        totalMovies: Object.keys(db.movies).length,
        lastUpdate: db.lastUpdate
    });
});

// Маппинг жанров на ID Кинопоиска
const GENRE_IDS = {
    'action': 3,      // боевик
    'drama': 2,       // драма  
    'comedy': 13,     // комедия
    'horror': 17,     // ужасы
    'scifi': 6,       // фантастика
    'romance': 4,     // мелодрама
    'thriller': 1,    // триллер
    'fantasy': 5,     // фэнтези
    'animation': 18,  // мультфильм
    'crime': 3,       // криминал
    'adventure': 7,   // приключения
    'family': 19      // семейный
};

// Маппинг стран на ID
const COUNTRY_IDS = {
    'США': 1,
    'Россия': 34,
    'Великобритания': 11,
    'Франция': 3,
    'Германия': 9,
    'Корея': 49,
    'Япония': 12,
    'Индия': 32
};

// Универсальный API с фильтрами
app.get('/api/films', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const year = req.query.year || '';
    const genre = req.query.genre || '';
    const country = req.query.country || '';
    const sort = req.query.sort || 'RATING'; // RATING, NUM_VOTE, YEAR
    const type = req.query.type || 'ALL'; // FILM, TV_SERIES, ALL

    try {
        // Строим URL с параметрами
        let apiUrl = `https://kinopoiskapiunofficial.tech/api/v2.2/films?page=${page}&order=${sort}&type=${type}`;

        // Добавляем год
        if (year) {
            if (year === 'classic') {
                apiUrl += '&yearFrom=1950&yearTo=1989';
            } else if (year.includes('-')) {
                const [from, to] = year.split('-');
                apiUrl += `&yearFrom=${from}&yearTo=${to}`;
            } else {
                apiUrl += `&yearFrom=${year}&yearTo=${year}`;
            }
        }

        // Добавляем жанр
        if (genre && GENRE_IDS[genre]) {
            apiUrl += `&genres=${GENRE_IDS[genre]}`;
        }

        // Добавляем страну
        if (country && COUNTRY_IDS[country]) {
            apiUrl += `&countries=${COUNTRY_IDS[country]}`;
        }

        console.log(`🔍 [FILTER] ${apiUrl}`);

        const response = await fetch(apiUrl, {
            headers: {
                'X-API-KEY': API_KEY,
                'Content-Type': 'application/json',
            }
        });

        if (response.ok) {
            const data = await response.json();
            const movies = data.items?.map(film => {
                // Фильтруем no-poster
                let poster = film.posterUrlPreview;
                if (poster && poster.includes('no-poster')) poster = null;

                return {
                    id: film.kinopoiskId,
                    title: film.nameRu || film.nameOriginal,
                    year: film.year,
                    poster: poster,
                    rating: film.ratingKinopoisk || film.ratingImdb,
                    genres: film.genres?.map(g => g.genre) || [],
                    countries: film.countries?.map(c => c.country) || []
                };
            }) || [];

            // Сохраняем в кэш
            movies.forEach(m => {
                if (!getFromDatabase(m.id)) saveToDatabase(m.id, m);
            });

            return res.json({
                success: true,
                movies,
                page,
                totalPages: data.totalPages || 5,
                hasMore: page < (data.totalPages || 5),
                filters: { year, genre, country, sort }
            });
        }
    } catch (error) {
        console.error('Films filter error:', error.message);
    }

    // Fallback на локальную базу
    const db = loadDatabase();
    let filtered = Object.values(db.movies);

    // Фильтруем по году
    if (year && !year.includes('-') && year !== 'classic') {
        filtered = filtered.filter(m => m.year == year);
    }

    // Фильтруем по жанру
    if (genre) {
        const genreKeywords = GENRE_KEYWORDS[genre] || [genre];
        filtered = filtered.filter(m => {
            const movieGenres = (m.genres || []).map(g => g.toLowerCase());
            return genreKeywords.some(kw => movieGenres.some(mg => mg.includes(kw)));
        });
    }

    const perPage = 20;
    const start = (page - 1) * perPage;

    res.json({
        success: true,
        movies: filtered.slice(start, start + perPage),
        page,
        totalPages: Math.ceil(filtered.length / perPage) || 1,
        hasMore: start + perPage < filtered.length,
        filters: { year, genre, country, sort },
        source: 'cache'
    });
});

// Жанры/категории
const GENRE_KEYWORDS = {
    'action': ['боевик', 'экшн'],
    'drama': ['драма'],
    'comedy': ['комедия'],
    'horror': ['ужасы'],
    'scifi': ['фантастика', 'научная фантастика'],
    'romance': ['мелодрама'],
    'thriller': ['триллер'],
    'fantasy': ['фэнтези'],
    'animation': ['мультфильм', 'анимация'],
    'crime': ['криминал', 'детектив']
};

// Получить фильмы по жанру (с пагинацией)
app.get('/api/genre/:genre', async (req, res) => {
    const genre = req.params.genre.toLowerCase();
    const page = parseInt(req.query.page) || 1;
    const keywords = GENRE_KEYWORDS[genre];

    if (!keywords) {
        return res.status(400).json({ success: false, error: 'Unknown genre' });
    }

    try {
        const response = await fetch(
            `${API_BASE}?keyword=${encodeURIComponent(keywords[0])}&page=${page}`,
            {
                headers: {
                    'X-API-KEY': API_KEY,
                    'Content-Type': 'application/json',
                }
            }
        );

        if (response.ok) {
            const data = await response.json();
            const movies = data.items?.map(film => ({
                id: film.kinopoiskId,
                title: film.nameRu || film.nameOriginal,
                year: film.year,
                poster: film.posterUrlPreview,
                rating: film.ratingKinopoisk || film.ratingImdb,
                genres: film.genres?.map(g => g.genre) || []
            })) || [];

            movies.forEach(m => {
                if (!getFromDatabase(m.id)) saveToDatabase(m.id, m);
            });

            return res.json({
                success: true,
                movies,
                genre,
                page,
                totalPages: data.totalPages || 10,
                hasMore: page < (data.totalPages || 10)
            });
        }
    } catch (error) {
        console.error('Genre fetch error:', error.message);
    }

    // Фильтруем из локальной базы
    const db = loadDatabase();
    const filtered = Object.values(db.movies).filter(m => {
        const movieGenres = (m.genres || []).map(g => g.toLowerCase());
        return keywords.some(kw => movieGenres.some(mg => mg.includes(kw)));
    });

    const perPage = 20;
    const start = (page - 1) * perPage;

    res.json({
        success: true,
        movies: filtered.slice(start, start + perPage),
        genre,
        page,
        totalPages: Math.ceil(filtered.length / perPage),
        hasMore: start + perPage < filtered.length
    });
});

// Новинки (с пагинацией) - используем API премьер
app.get('/api/new', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const year = req.query.year || new Date().getFullYear();
    const month = req.query.month || new Date().toLocaleString('en-US', { month: 'long' }).toUpperCase();

    try {
        // Пробуем API премьер
        const response = await fetch(
            `https://kinopoiskapiunofficial.tech/api/v2.2/films/premieres?year=${year}&month=${month}`,
            {
                headers: {
                    'X-API-KEY': API_KEY,
                    'Content-Type': 'application/json',
                }
            }
        );

        if (response.ok) {
            const data = await response.json();
            const allMovies = data.items?.map(film => ({
                id: film.kinopoiskId,
                title: film.nameRu || film.nameOriginal,
                year: film.year,
                poster: film.posterUrlPreview,
                rating: film.ratingKinopoisk || film.ratingImdb,
                genres: film.genres?.map(g => g.genre) || [],
                premiereRu: film.premiereRu
            })) || [];

            // Пагинация на стороне сервера
            const perPage = 20;
            const start = (page - 1) * perPage;
            const movies = allMovies.slice(start, start + perPage);

            movies.forEach(m => saveToDatabase(m.id, m));
            return res.json({
                success: true,
                movies,
                page,
                totalPages: Math.ceil(allMovies.length / perPage) || 5,
                hasMore: start + perPage < allMovies.length
            });
        }
    } catch (error) {
        console.error('Premieres error:', error.message);
    }

    // Fallback на коллекцию TOP_AWAIT
    try {
        const response = await fetch(
            `https://kinopoiskapiunofficial.tech/api/v2.2/films/collections?type=TOP_AWAIT&page=${page}`,
            {
                headers: {
                    'X-API-KEY': API_KEY,
                    'Content-Type': 'application/json',
                }
            }
        );

        if (response.ok) {
            const data = await response.json();
            const movies = data.items?.map(film => ({
                id: film.kinopoiskId,
                title: film.nameRu || film.nameOriginal,
                year: film.year,
                poster: film.posterUrlPreview,
                rating: film.ratingKinopoisk || film.ratingImdb,
                genres: film.genres?.map(g => g.genre) || []
            })) || [];

            movies.forEach(m => saveToDatabase(m.id, m));
            return res.json({
                success: true,
                movies,
                page,
                totalPages: data.totalPages || 10,
                hasMore: page < (data.totalPages || 10)
            });
        }
    } catch (error) {
        console.error('New releases error:', error.message);
    }

    const db = loadDatabase();
    const newMovies = Object.values(db.movies)
        .filter(m => m.year >= 2023)
        .sort((a, b) => (b.year || 0) - (a.year || 0));

    const perPage = 20;
    const start = (page - 1) * perPage;

    res.json({
        success: true,
        movies: newMovies.slice(start, start + perPage),
        page,
        totalPages: Math.ceil(newMovies.length / perPage),
        hasMore: start + perPage < newMovies.length
    });
});

// Сериалы (с пагинацией)
app.get('/api/series', async (req, res) => {
    const page = parseInt(req.query.page) || 1;

    try {
        const response = await fetch(
            `https://kinopoiskapiunofficial.tech/api/v2.2/films/collections?type=TOP_POPULAR_ALL&page=${page}`,
            {
                headers: {
                    'X-API-KEY': API_KEY,
                    'Content-Type': 'application/json',
                }
            }
        );

        if (response.ok) {
            const data = await response.json();
            const series = data.items
                ?.filter(f => f.type === 'TV_SERIES' || f.type === 'MINI_SERIES')
                .map(film => ({
                    id: film.kinopoiskId,
                    title: film.nameRu || film.nameOriginal,
                    year: film.year,
                    poster: film.posterUrlPreview,
                    rating: film.ratingKinopoisk || film.ratingImdb,
                    genres: film.genres?.map(g => g.genre) || [],
                    type: 'series'
                })) || [];

            series.forEach(m => saveToDatabase(m.id, m));
            return res.json({
                success: true,
                movies: series,
                page,
                totalPages: data.totalPages || 10,
                hasMore: page < (data.totalPages || 10)
            });
        }
    } catch (error) {
        console.error('Series error:', error.message);
    }

    const db = loadDatabase();
    const series = Object.values(db.movies).filter(m => m.type === 'series');
    const perPage = 20;
    const start = (page - 1) * perPage;

    res.json({
        success: true,
        movies: series.slice(start, start + perPage),
        page,
        totalPages: Math.ceil(series.length / perPage),
        hasMore: start + perPage < series.length
    });
});

// ================== PAGES ==================

// Страница просмотра
app.get('/watch/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'watch.html'));
});

// Страница фильма (инфо)
app.get('/movie/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'watch.html'));
});

// Страница категории
app.get('/category/:name', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'category.html'));
});

// Страница фильмов
app.get('/movies', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'category.html'));
});

// Страница сериалов  
app.get('/series', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'category.html'));
});

// Страница новинок
app.get('/new', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'category.html'));
});

// Главная
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ================== START ==================

initDatabase();

app.listen(PORT, async () => {
    console.log('');
    console.log('╔════════════════════════════════════════════╗');
    console.log('║     🎬 CINEMATIC — Premium Movie Site      ║');
    console.log('╠════════════════════════════════════════════╣');
    console.log(`║  🌐 Server: http://localhost:${PORT}            ║`);
    console.log('║  📦 Database: ./data/movies.json           ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log('');

    // Предзагрузка популярных фильмов
    await preloadPopularMovies();

    // Обогащаем существующие фильмы описаниями (в фоне)
    enrichMoviesWithDescriptions();
});
