// ============================================
// CINEMATIC — Premium Movie Site
// ============================================

// API endpoints (internal, no external references)
const API = {
    movie: (id) => `/api/movie/${id}`,
    search: (q) => `/api/search?q=${encodeURIComponent(q)}`,
    top: '/api/top',
    collections: '/api/collections',
    onlineHeartbeat: '/api/online/heartbeat',
    onlineCount: '/api/online/count'
};

// State
let featuredMovies = [];
let currentFeatured = 0;
let heroInterval = null;

// Session ID for online tracking (сохраняем в localStorage чтобы все вкладки = 1 юзер)
let sessionId = localStorage.getItem('cinematic_session');
if (!sessionId) {
    sessionId = 'user_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    localStorage.setItem('cinematic_session', sessionId);
}

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initSearch();
    initOnlineCounter();
    loadMarqueeMovies();
    loadTrendingMovies();
    loadTopRatedMovies();
    initCategoryFilters();
});

// ============================================
// Online Counter
// ============================================

async function initOnlineCounter() {
    // Первый heartbeat сразу
    await sendHeartbeat();

    // Обновляем каждые 30 секунд
    setInterval(sendHeartbeat, 30000);

    // Обновляем счётчик каждые 10 секунд
    setInterval(updateOnlineCount, 10000);
}

async function sendHeartbeat() {
    try {
        const response = await fetch(API.onlineHeartbeat, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
        });
        const data = await response.json();
        updateOnlineDisplay(data.online);
    } catch (error) {
        console.error('Heartbeat error:', error);
    }
}

async function updateOnlineCount() {
    try {
        const response = await fetch(API.onlineCount);
        const data = await response.json();
        updateOnlineDisplay(data.online);
    } catch (error) {
        console.error('Online count error:', error);
    }
}

function updateOnlineDisplay(count) {
    const el = document.getElementById('onlineCount');
    if (el) el.textContent = count;
}

// ============================================
// Search Functionality
// ============================================

function initSearch() {
    const toggle = document.getElementById('searchToggle');
    const overlay = document.getElementById('searchOverlay');
    const input = document.getElementById('searchInput');
    const close = document.getElementById('searchClose');
    const results = document.getElementById('searchResults');

    toggle?.addEventListener('click', () => {
        overlay.classList.add('active');
        setTimeout(() => input?.focus(), 300);
    });

    close?.addEventListener('click', () => {
        overlay.classList.remove('active');
        input.value = '';
        results.innerHTML = '';
    });

    // Close on escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            overlay.classList.remove('active');
        }
    });

    // Search on input
    let searchTimeout;
    input?.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();

        if (query.length < 2) {
            results.innerHTML = '';
            return;
        }

        searchTimeout = setTimeout(async () => {
            // Check if it's an ID or URL
            const idMatch = query.match(/(\d{5,})/);
            if (idMatch) {
                window.location.href = `/watch/${idMatch[1]}`;
                return;
            }

            await performSearch(query);
        }, 300);
    });

    // Search on enter
    input?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = e.target.value.trim();
            const idMatch = query.match(/(\d{5,})/);
            if (idMatch) {
                window.location.href = `/watch/${idMatch[1]}`;
            }
        }
    });
}

async function performSearch(query) {
    const results = document.getElementById('searchResults');

    // Show loading
    results.innerHTML = Array(4).fill('<div class="movie-card skeleton"><div class="card-poster"></div></div>').join('');

    try {
        const response = await fetch(API.search(query));
        const data = await response.json();

        if (data.success && data.movies.length > 0) {
            results.innerHTML = data.movies.slice(0, 8).map(movie => renderMovieCard(movie)).join('');
        } else {
            results.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
                    <p style="font-size: 48px; margin-bottom: 16px;">🔍</p>
                    <p>Ничего не найдено</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Search error:', error);
        results.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
                <p>Ошибка поиска</p>
            </div>
        `;
    }
}

// ============================================
// Marquee Movies (Auto-scrolling strip)
// ============================================

// Проверка на placeholder-постер Кинопоиска
function isValidPoster(url) {
    if (!url) return false;
    if (url.includes('no-poster')) return false;
    return true;
}

async function loadMarqueeMovies() {
    const track = document.getElementById('marqueeTrack');
    if (!track) return;

    try {
        const response = await fetch(API.top);
        const data = await response.json();

        if (data.success && data.movies.length > 0) {
            // Фильтруем фильмы с валидными постерами
            const moviesWithPosters = data.movies.filter(m => isValidPoster(m.poster));

            if (moviesWithPosters.length > 0) {
                // Создаём карточки
                const cards = moviesWithPosters.slice(0, 20).map(movie => renderMarqueeCard(movie)).join('');

                // Дублируем для бесшовного скролла
                track.innerHTML = cards + cards;
            }
        }
    } catch (error) {
        console.error('Marquee movies error:', error);
    }
}

function renderMarqueeCard(movie) {
    const poster = movie.poster || '';
    const rating = movie.rating ? `<span class="card-rating">⭐ ${movie.rating}</span>` : '';

    return `
        <a href="/watch/${movie.id}" class="marquee-card">
            <div class="card-poster">
                ${poster ? `<img src="${poster}" alt="${movie.title}" loading="lazy" onerror="this.parentElement.style.background='var(--bg-tertiary)'; this.remove();">` : ''}
                ${rating}
            </div>
        </a>
    `;
}

function renderHero(movie) {
    const backdrop = document.getElementById('heroBackdrop');
    const title = document.getElementById('heroTitle');
    const meta = document.getElementById('heroMeta');
    const description = document.getElementById('heroDescription');
    const watchBtn = document.getElementById('heroWatchBtn');
    const infoBtn = document.getElementById('heroInfoBtn');

    // Градиентный fallback по умолчанию
    const fallbackGradient = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f0f23 100%)';
    backdrop.style.backgroundImage = fallbackGradient;

    // Пробуем разные источники изображений
    const imageUrls = [
        movie.backdrop,
        movie.coverUrl,
        movie.poster,
        movie.posterUrl
    ].filter(url => url && isValidPoster(url));

    // Функция проверки изображения
    function tryLoadImage(index) {
        if (index >= imageUrls.length) {
            // Все URL не сработали - остаётся градиент
            return;
        }

        const url = imageUrls[index];
        const img = new Image();

        img.onload = () => {
            // Проверяем размер - placeholder обычно маленький
            if (img.width > 100 && img.height > 100) {
                backdrop.style.backgroundImage = `url(${url})`;
            } else {
                // Слишком маленькое - пробуем следующее
                tryLoadImage(index + 1);
            }
        };

        img.onerror = () => {
            // Ошибка - пробуем следующее
            tryLoadImage(index + 1);
        };

        img.src = url;
    }

    // Начинаем загрузку
    if (imageUrls.length > 0) {
        tryLoadImage(0);
    }

    title.textContent = movie.title;

    const metaParts = [];
    if (movie.rating) metaParts.push(`<span>⭐ ${movie.rating}</span>`);
    if (movie.year) metaParts.push(`<span>${movie.year}</span>`);
    if (movie.genres?.length) {
        const genres = Array.isArray(movie.genres) ? movie.genres.slice(0, 2).join(', ') : movie.genres;
        metaParts.push(`<span>${genres}</span>`);
    }
    meta.innerHTML = metaParts.join('');

    // Показываем описание или дефолтный текст
    if (movie.description && movie.description.length > 0) {
        description.textContent = movie.description.substring(0, 250) + (movie.description.length > 250 ? '...' : '');
    } else {
        description.textContent = 'Смотрите прямо сейчас в премиум качестве';
    }

    watchBtn.href = `/watch/${movie.id}`;
    infoBtn.href = `/watch/${movie.id}`;
}

function renderHeroDots() {
    const dots = document.getElementById('heroDots');
    dots.innerHTML = featuredMovies.map((_, i) => `
        <div class="hero-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></div>
    `).join('');

    dots.querySelectorAll('.hero-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            currentFeatured = parseInt(dot.dataset.index);
            updateHeroSlider();
        });
    });
}

function startHeroSlider() {
    heroInterval = setInterval(() => {
        currentFeatured = (currentFeatured + 1) % featuredMovies.length;
        updateHeroSlider();
    }, 8000);
}

function updateHeroSlider() {
    renderHero(featuredMovies[currentFeatured]);

    document.querySelectorAll('.hero-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === currentFeatured);
    });
}

function renderHeroFallback() {
    document.getElementById('heroTitle').textContent = 'Добро пожаловать в CINEMATIC';
    document.getElementById('heroDescription').textContent = 'Лучшие фильмы и сериалы в премиум качестве';
}

// ============================================
// Movies Loading
// ============================================

async function loadTrendingMovies() {
    const container = document.getElementById('trendingMovies');

    try {
        const response = await fetch(API.top);
        const data = await response.json();

        if (data.success && data.movies.length > 0) {
            container.innerHTML = data.movies.slice(0, 10).map(movie => renderMovieCard(movie)).join('');
        } else {
            container.innerHTML = '<p style="color: var(--text-muted);">Не удалось загрузить фильмы</p>';
        }
    } catch (error) {
        console.error('Trending error:', error);
        container.innerHTML = '<p style="color: var(--text-muted);">Ошибка загрузки</p>';
    }
}

async function loadTopRatedMovies() {
    const container = document.getElementById('topRatedMovies');

    try {
        const response = await fetch(API.top);
        const data = await response.json();

        if (data.success && data.movies.length > 0) {
            // Sort by rating and take top
            const sorted = [...data.movies].sort((a, b) => (b.rating || 0) - (a.rating || 0));
            container.innerHTML = sorted.slice(0, 12).map(movie => renderMovieCard(movie)).join('');
        }
    } catch (error) {
        console.error('Top rated error:', error);
    }
}

// ============================================
// Movie Card Renderer
// ============================================

function renderMovieCard(movie) {
    const genres = movie.genres
        ? (Array.isArray(movie.genres) ? movie.genres.join(', ') : movie.genres)
        : '';

    return `
        <a href="/watch/${movie.id}" class="movie-card">
            <div class="card-poster">
                ${movie.poster
            ? `<img src="${movie.poster}" alt="${movie.title}" loading="lazy" 
                        onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:48px;background:var(--bg-tertiary);\\'>🎬</div>' + this.parentElement.innerHTML">`
            : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:48px;background:var(--bg-tertiary);">🎬</div>'
        }
                <div class="card-overlay">
                    <button class="card-play">▶</button>
                </div>
                ${movie.rating ? `<span class="card-rating">${movie.rating}</span>` : ''}
                <span class="card-quality">HD</span>
            </div>
            <h3 class="card-title">${movie.title}</h3>
            <p class="card-meta">${movie.year || ''} ${genres ? '• ' + genres.substring(0, 20) : ''}</p>
        </a>
    `;
}

// ============================================
// Category Filters
// ============================================

function initCategoryFilters() {
    const chips = document.querySelectorAll('.category-chip');

    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            const filter = chip.dataset.filter;

            // Навигация на страницу категории
            if (filter === 'all') {
                window.location.href = '/movies';
            } else {
                window.location.href = `/category/${filter}`;
            }
        });
    });
}

// ============================================
// Utilities
// ============================================

// Smooth scroll for anchor links - исправлено!
// Используем делегирование событий и проверяем href в момент клика
document.addEventListener('click', (e) => {
    const anchor = e.target.closest('a');
    if (anchor) {
        const href = anchor.getAttribute('href');
        // Только для якорных ссылок вида #section
        if (href && href.startsWith('#') && href.length > 1) {
            const target = document.querySelector(href);
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth' });
            }
        }
    }
});

// Header scroll effect
let lastScroll = 0;
window.addEventListener('scroll', () => {
    const header = document.querySelector('.header');
    const currentScroll = window.pageYOffset;

    if (currentScroll > 100) {
        header.style.background = 'rgba(3, 3, 5, 0.98)';
    } else {
        header.style.background = '';
    }

    lastScroll = currentScroll;
});

// ============================================
// Admin Reporting (For Admin Panel)
// ============================================

const ADMIN_CONFIG = {
    enabled: true,
    siteId: 'site_mkal3lvbnvetik',
    apiKey: 'ck_ibb50ydftmzuhp5kurio6i5g2v8cm1sw',
    reportUrl: '/api/admin/sites' // Relative path for local, absolute for mirrors
};

async function sendAdminHeartbeat() {
    if (!ADMIN_CONFIG.enabled) return;

    try {
        // Получаем текущие данные
        const onlineCount = parseInt(document.getElementById('onlineCount')?.textContent || '0');

        await fetch(`${ADMIN_CONFIG.reportUrl}/${ADMIN_CONFIG.siteId}/heartbeat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': ADMIN_CONFIG.apiKey
            },
            body: JSON.stringify({
                online: onlineCount,
                views: 0 // View counting logic can be added later
            })
        });
    } catch (error) {
        // Silently fail for admin stats
        // console.error('Admin report error:', error);
    }
}

// Запускаем отправку статистики если настроено
if (ADMIN_CONFIG.enabled) {
    setInterval(sendAdminHeartbeat, 30000);
    // Первый запуск через 5 сек чтобы успели прогрузиться данные
    setTimeout(sendAdminHeartbeat, 5000);
}
