import dotenv from "dotenv";
dotenv.config();

const BASE_URL = process.env.BASE_URL || "http://localhost:3200";

// AHORA SÍ mostramos lo que cargó dotenv
console.log("ENV BASE:", process.env.FLEXXUS_BASE);
console.log("Working dir:", process.cwd());

// ===============================
// IMPORTS
// ===============================
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import fs from "fs";
import fetch from "node-fetch";
import { google } from "googleapis";
import mysql from "mysql2/promise";

// ===============================
// DEFINIR __dirname *ANTES DE TODO*
// ===============================
import bcrypt from "bcrypt";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_HTML_PATH = process.env.PUBLIC_HTML_PATH
  ? path.resolve(process.env.PUBLIC_HTML_PATH)
  : path.join(__dirname, "public");

// ===============================
// CONSTANTE: IMAGEN DEFAULT
// ===============================
const DEFAULT_MOTO_IMAGE = "/imagenes/img_logo/img_logo_fr.png";


// ===============================
// DATA LOCAL (complementos por codigoarticulo)
// ===============================
const DATA_DIR = path.join(process.cwd(), "data");
const COMPLEMENTS_PATH = path.join(DATA_DIR, "complements.json");
function obtenerModeloYColorBackend(descripcion = "") {
  const texto = descripcion.trim();
  if (!texto) return { modeloBase: "", color: "" };

  const upper = texto.toUpperCase();

  const idx = upper.lastIndexOf(" COLOR ");
  if (idx !== -1) {
    return {
      modeloBase: texto.slice(0, idx).trim(),
      color: texto.slice(idx + 7).trim()
    };
  }

  const partes = texto.split(/\s+/);
  const ultima = partes[partes.length - 1].toUpperCase();

  const colores = [
    "ROJO","NEGRO","BLANCO","AZUL","GRIS",
    "VERDE","BEIGE","MARRON","MARRÓN","PLATA","AMARILLO"
  ];

  if (colores.includes(ultima)) {
    return {
      modeloBase: partes.slice(0, -1).join(" "),
      color: ultima
    };
  }

  return { modeloBase: texto, color: "" };
}

function obtenerModeloBase(descripcion = "") {
  const texto = descripcion.trim().toUpperCase();
  if (!texto) return "";

  const idx = texto.lastIndexOf(" COLOR ");
  if (idx !== -1) return texto.slice(0, idx).trim();

  const partes = texto.split(/\s+/);
  const colores = [
    "ROJO","NEGRO","BLANCO","AZUL","GRIS",
    "VERDE","BEIGE","MARRON","MARRÓN","PLATA","AMARILLO"
  ];

  const ultima = partes[partes.length - 1];
  if (colores.includes(ultima)) return partes.slice(0, -1).join(" ");

  return texto;
}

// ===============================
// MIDDLEWARE AUTH ADMIN (FASE 1)
// ===============================
// ===============================
// MIDDLEWARE AUTH ADMIN (JWT)
// ===============================
function requireAdmin(req, res, next) {
  const token = req.cookies.admin_token;

  if (!token) {
    return res.status(401).json({
      ok: false,
      error: "No autorizado (sin sesión)"
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);

    if (decoded.rol !== "admin") {
      return res.status(403).json({
        ok: false,
        error: "Permisos insuficientes"
      });
    }

    // guardamos info del admin para usar luego
    req.admin = decoded;
    next();

  } catch (err) {
    console.error("❌ Token inválido:", err);
    return res.status(401).json({
      ok: false,
      error: "Sesión inválida o expirada"
    });
  }
}


// ===============================
// FLEX CACHE EN MEMORIA (ULTRA RÁPIDO)
// ===============================
let FLEX_CACHE_MEMORY = null;
let FLEX_CACHE_LAST_UPDATE = 0;

async function getFlexCacheMemory() {
  const disk = readFlexCache();
if (Array.isArray(disk.articulos) && disk.articulos.length > 0) {
  console.log("🛡 Flexxus bloqueado → usando cache local");
  return disk.articulos;
}

  const ahora = Date.now();
  const CINCO_MINUTOS = 5 * 60 * 1000;

  if (FLEX_CACHE_MEMORY && ahora - FLEX_CACHE_LAST_UPDATE < CINCO_MINUTOS) {
    return FLEX_CACHE_MEMORY;
  }

  

  if (Array.isArray(disk.articulos) && disk.articulos.length > 0) {
    console.log("⚡ Usando FLEX_CACHE desde disco");
    FLEX_CACHE_MEMORY = disk.articulos;
    FLEX_CACHE_LAST_UPDATE = ahora;
    return FLEX_CACHE_MEMORY;
  }

  console.log("⏳ Cache vacío → pidiendo a Flexxus...");

 const resp = await flexGet(`/productos`);
const raw = resp?.data || [];

const articulos = raw.map(p => ({
  codigoarticulo: String(p.ID_ARTICULO || p.CODIGO_PRODUCTO || "").trim(),
  descripcion: p.NOMBRE || "",
  marca: { descripcion: p.MARCA || p.DESCRIPCION_MARCA || "" },
  precioventa1: Number(p.PRECIOVENTA || p.PRECIO_VENTA || 0),
  _origen: "productos"
}));


  writeFlexCache({
    timestamp: ahora,
    articulos
  });

  FLEX_CACHE_MEMORY = articulos;
  FLEX_CACHE_LAST_UPDATE = ahora;

  return FLEX_CACHE_MEMORY;
}


// ===============================
// FLEX CACHE GENERAL
// ===============================
const FLEX_CACHE_PATH = path.join(DATA_DIR, "flex_cache.json");

// Leer cache
function readFlexCache() {
  try {
    if (!fs.existsSync(FLEX_CACHE_PATH)) {
      return { timestamp: 0, articulos: [] };
    }

    const raw = fs.readFileSync(FLEX_CACHE_PATH, "utf8");
    const json = JSON.parse(raw || "{}");

    return {
      timestamp: json.timestamp || 0,
      articulos: Array.isArray(json.articulos) ? json.articulos : []
    };

  } catch (e) {
    console.error("❌ Error leyendo flex_cache:", e);
    return { timestamp: 0, articulos: [] };
  }
}


// Guardar cache
function writeFlexCache(obj) {
  try {
    fs.writeFileSync(FLEX_CACHE_PATH, JSON.stringify(obj, null, 2), "utf-8");
  } catch (e) {
    console.error("❌ Error escribiendo flex_cache:", e);
  }
}

// Verificar si el cache está vencido
function cacheVencido() {
  const c = readFlexCache();
  const ahora = Date.now();
  
  const CINCO_MINUTOS = 5 * 60 * 1000;

  return ahora - (c.timestamp || 0) > CINCO_MINUTOS;
}
// =============================================================
// OBTENER ARTÍCULOS DE FLEXXUS CON CACHÉ GLOBAL
// =============================================================
async function getArticulosFlexCached() {
  const cache = readFlexCache();

  // Si hay cache, y NO está vencido → usarlo
  if (cache && Array.isArray(cache.articulos) && !cacheVencido()) {
    console.log("⚡ Usando articulos desde FLEX_CACHE");
    return cache.articulos;
  }

  // Si no hay cache o está vencido → pedir a Flexxus
  console.log("⏳ Cache vacío o vencido → pidiendo a Flexxus...");
  const resp = await flexGet(`/articulos?limit=5000`);
  const articulos = resp?.data || [];

  // Guardar en archivo
  writeFlexCache({
    timestamp: Date.now(),
    articulos,
  });

  console.log(`✅ FLEX_CACHE actualizado. Total articulos: ${articulos.length}`);

  return articulos;
}

// ===============================
// HELPERS: HOME-CONTENT Y COMPLEMENTS
// ===============================
const HOME_CONTENT_PATH = path.join(DATA_DIR, "home_content.json");
const calendarCredentialsPath = path.join(
  __dirname,
  "credenciales",
  "google-calendar.json"
);

const auth = new google.auth.GoogleAuth({
  keyFile: calendarCredentialsPath,
  scopes: ["https://www.googleapis.com/auth/calendar"],
});

const calendar = google.calendar({ version: "v3", auth });

// Carga el archivo de contenidos del home (banners, marcas, destacados, etc.)
function loadHomeContent() {
  try {
    if (!fs.existsSync(HOME_CONTENT_PATH)) {
      return {};
    }
    const raw = fs.readFileSync(HOME_CONTENT_PATH, "utf8");
    return JSON.parse(raw || "{}");
  } catch (err) {
    console.error("❌ Error leyendo home-content:", err);
    return {};
  }
}

// Carga complements.json y devuelve un diccionario por código
function loadComplementsIndex() {
  try {
    if (!fs.existsSync(COMPLEMENTS_PATH)) {
      return {};
    }
    const raw = fs.readFileSync(COMPLEMENTS_PATH, "utf8");
    const arr = JSON.parse(raw || "[]");

    const index = {};
    for (const item of arr) {
      const codigo =
        item.codigo ||
        item.codigoarticulo ||
        item.codigoArticulo ||
        item.CODIGO_PRODUCTO ||
        item.ID_ARTICULO ||
        item.CODIGO ||
        String(item.codigo || "").trim();

      if (!codigo) continue;
      index[String(codigo)] = item;
    }
    return index;

  } catch (err) {
    console.error("❌ Error leyendo complements.json:", err);
    return {};
  }
}

function ensureDataFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(COMPLEMENTS_PATH))
      fs.writeFileSync(COMPLEMENTS_PATH, "{}", "utf-8");
  } catch (e) {
    console.error("❌ No se pudo preparar el data store:", e);
  }
}
ensureDataFile();

function readComplements() {
  try {
    const raw = fs.readFileSync(COMPLEMENTS_PATH, "utf-8");
    return JSON.parse(raw || "{}");
  } catch (e) {
    return {};
  }
}


const DESTACADOS_CACHE_PATH = path.join(DATA_DIR, "destacados_cache.json");

function readDestacadosCache() {
  try {
    if (!fs.existsSync(DESTACADOS_CACHE_PATH)) {
      return { lastUpdate: 0, items: [] };
    }
    return JSON.parse(fs.readFileSync(DESTACADOS_CACHE_PATH, "utf8"));
  } catch (e) {
    return { lastUpdate: 0, items: [] };
  }
}

function writeDestacadosCache(obj) {
  try {
    fs.writeFileSync(
      DESTACADOS_CACHE_PATH,
      JSON.stringify(obj, null, 2),
      "utf8"
    );
  } catch (e) {
    console.error("❌ Error guardando cache destacados:", e);
  }
}

// ===============================
// HOME CONTENT (banners del index)
// ==============================

function readHomeContent() {
  try {
    const raw = fs.readFileSync(HOME_CONTENT_PATH, "utf-8");
    return JSON.parse(raw || "{}");
  } catch (e) {
    console.error("❌ Error leyendo home_content.json:", e);
    return {};
  }
}

function writeHomeContent(obj) {
  try {
    fs.writeFileSync(HOME_CONTENT_PATH, JSON.stringify(obj, null, 2), "utf-8");
  } catch (e) {
    console.error("❌ Error escribiendo home_content.json:", e);
  }
}

function upsertComplement(codigoarticulo, data) {
  const all = readComplements();
  all[codigoarticulo] = { ...(all[codigoarticulo] || {}), ...data };
  writeComplements(all);
  return all[codigoarticulo];
}

// ===============================
// CONFIG
// ===============================
const app = express();

const allowedOrigins = [
  "http://localhost:3200",
  "https://frontera-center.store"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Origen no permitido por CORS"));
    }
  },
  credentials: true
}));


app.use(cookieParser());
app.use(express.json());

app.use(express.urlencoded({ extended: true }));


// Imágenes del frontend (DonWeb y local)
const FRONT_IMAGES = path.join(PUBLIC_HTML_PATH, "imagenes");

// Imágenes del backend (donde ya están tus archivos reales)
const BACK_IMAGES = path.join(__dirname, "public", "imagenes");

// Servir ambas rutas
app.use("/imagenes", express.static(FRONT_IMAGES));
app.use("/imagenes", express.static(BACK_IMAGES));


const FICHAS_DIR = path.join(PUBLIC_HTML_PATH, "fichas");
app.use("/fichas", express.static(FICHAS_DIR));


app.use(express.static(PUBLIC_HTML_PATH));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_HTML_PATH, "html", "index.html"));
});



// ===============================
// FLEXXUS CONFIG
// ===============================
const FLEX = {
  base: process.env.FLEXXUS_BASE,
  token: process.env.FLEXXUS_TOKEN,
};
console.log("🔑 TOKEN FLEX (primeros 30):", FLEX.token?.slice(0,30));
console.log("🌐 BASE FLEX:", FLEX.base);

async function flexGet(pathRoute) {
  const url = `${FLEX.base}${pathRoute}`;

  try {
    const r = await fetch(url, {
  method: "GET",
  headers: {
    "Authorization": `Bearer ${FLEX.token}`,
    "Accept": "application/json",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0"
  }
});

    const text = await r.text();

   if (!text.trim().startsWith("{")) {
  console.error("RESPUESTA FLEXXUS CRUDA:\n", text.slice(0,500));
  throw new Error("Flexxus devolvió HTML");
}


    return JSON.parse(text);

  } catch (e) {
    console.warn("⚠ Flexxus no disponible:", e.message);

    const cache = readFlexCache();

    if (Array.isArray(cache.articulos) && cache.articulos.length > 0) {
      console.warn("🗂 Usando cache local de Flexxus");
      return { data: cache.articulos };
    }

    // 👇 CLAVE: no romper, devolver vacío
    return { data: [] };
  }
}

// ===============================
// MYSQL - CONEXIÓN BASE DE DATOS
// ===============================
const db = await mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
});


// ===============================
// DETALLE DE UNA MOTO (SUPER RÁPIDO CON CACHÉ GLOBAL)
// ===============================
app.get("/api/moto/:codigo", async (req, res) => {
  try {
    let codigoParam = req.params.codigo?.trim();
    if (!codigoParam)
      return res.status(400).json({ error: "Falta código" });

    // Normalizar código
    const normalizar = (str = "") =>
      String(str).toUpperCase().replace(/[^A-Z0-9]/g, "");

    const codigoSinCeros = codigoParam.replace(/^0+/, "");
    const padded = codigoSinCeros.padStart(5, "0");

    // 🔥 Obtener artículos DESDE CACHÉ
    const articulos = await getFlexCacheMemory();

    // Buscar coincidencias en cache
    let moto =
      articulos.find((a) =>
        [codigoParam, codigoSinCeros, padded].some(
          (c) =>
            normalizar(a.codigoarticulo) === normalizar(c)
        )
      ) ||
      articulos.find((a) =>
        [codigoParam, codigoSinCeros, padded].some(
          (c) => normalizar(a.codigo) === normalizar(c)
        )
      );

    if (!moto) {
      return res.status(404).json({ error: "Moto no encontrada" });
    }

    // Calcular precio final
    const base = Number(moto.precioventa1 || 0);
    const precioFinal = +(base * 1.21).toFixed(2);

    // Obtener complements
    const complements = readComplements();
    const comp =
      complements[moto.codigoarticulo] ||
      complements[codigoParam] ||
      complements[codigoSinCeros] ||
      complements[padded] ||
      {};
// ===============================
// GENERAR COLORES AUTOMÁTICOS SI NO VIENEN EN COMPLEMENTS
// (SIN MEZCLAR MODELOS SIMILARES)
// ===============================
let coloresAuto = comp.colores || [];

if (!Array.isArray(coloresAuto) || coloresAuto.length === 0) {
  try {
   const modeloBase = obtenerModeloBase(moto.descripcion || "");


    if (!modeloBase) {
      coloresAuto = [];
    } else {
      const variantes = articulos.filter(a => {
        const r = obtenerModeloYColorBackend(
a.descripcion || "");
        return r.modeloBase === modeloBase;
      });

      const map = new Map();

      for (const a of variantes) {
        const r =obtenerModeloYColorBackend(
a.descripcion || "");
        if (!r.color) continue;

        const codigo = String(a.codigoarticulo || "").trim();
        if (map.has(r.color)) continue;

        map.set(r.color, {
          color: r.color,
          codigo,
          precio: +(Number(a.precioventa1 || 0) * 1.21).toFixed(2),
          imagen:
            complements[codigo]?.imagenPrincipal ||
            comp.imagenPrincipal ||
            DEFAULT_MOTO_IMAGE,
        });
      }

      coloresAuto = Array.from(map.values());
    }
  } catch (e) {
    console.error("❌ Error generando colores:", e);
    coloresAuto = [];
  }
}
    // RESPUESTA FINAL DEL DETALLE DE MOTO
  return res.json({
  ok: true,
  data: {
    codigo: moto.codigoarticulo,
    descripcion: moto.descripcion,
    marca: moto.marca?.descripcion || "",
    precioFinal,
    imagenPrincipal: comp.imagenPrincipal || DEFAULT_MOTO_IMAGE,
    miniaturas: comp.miniaturas || [],
    colores: coloresAuto,
    fichaTecnica: comp.fichaTecnica || null,
  }
});


  } catch (e) {
    console.error("❌ Error en /api/moto/:codigo:", e);
    return res.status(500).json({ error: "Error interno en detalle moto" });
  }
});


// ===============================
// /api/marcas
// ===============================
app.get("/api/marcas", async (req, res) => {
  try {
    console.log("🟡 /api/marcas llamado");
    const articulos = await getFlexCacheMemory();

    console.log("🟢 Flexxus respondió OK");
    const marcasValidas = [
      "MOTOMEL",
      "BAJAJ",
      "BENELLI",
      "ZANELLA",
      "TVS",
      "HERO",
      "GILERA",
      "CORVEN",
      "SUZUKI",
      "YAMAHA",
    ];

    const unicas = {};
    articulos.forEach((a) => {
      const m = a?.marca?.descripcion?.toUpperCase();
      if (marcasValidas.includes(m)) unicas[m] = a.marca.codigomarca;
    });

    res.json({
      data: Object.entries(unicas).map(([nombre, codigo]) => ({
        nombre,
        codigo,
      })),
    });
  } catch (e) {
    console.error("❌ ERROR en /api/marcas:", e);
    res.status(500).json({ error: "Error al obtener marcas" });
  }
});
// ===============================
// ADMIN - MARCAS (puente para panel)
// ===============================
app.get("/api/admin/marcas", requireAdmin, async (req, res) => {
  try {
    const articulos = await getFlexCacheMemory();

    const marcasValidas = [
      "MOTOMEL","BAJAJ","BENELLI","ZANELLA","TVS",
      "HERO","GILERA","CORVEN","SUZUKI","YAMAHA"
    ];

    const unicas = {};
    articulos.forEach((a) => {
      const m = a?.marca?.descripcion?.toUpperCase();
      if (marcasValidas.includes(m)) unicas[m] = a.marca.codigomarca;
    });

    res.json({
      data: Object.entries(unicas).map(([nombre, codigo]) => ({ nombre, codigo }))
    });
  } catch (e) {
    console.error("❌ Error admin/marcas:", e);
    res.status(500).json({ error: "Error al obtener marcas" });
  }
});


// ===============================
// MODELOS POR MARCA
// ===============================
app.get("/api/modelos/:marca", async (req, res) => {
  try {
    const marca = req.params.marca?.toUpperCase();
    const articulos = await getFlexCacheMemory();


    const modelos = articulos
      .filter((a) => a?.marca?.descripcion?.toUpperCase() === marca)
      .map((m) => ({
        codigo: m.codigoarticulo,
        descripcion: m.descripcion,
      }));

    res.json({ data: modelos });
  } catch (e) {
    res.status(500).json({ error: "Error modelos" });
  }
});

// ===============================
// ADMIN - MODELOS POR MARCA (puente)
// ===============================
app.get("/api/admin/modelos/:marca", requireAdmin, async (req, res) => {
  try {
    const marca = req.params.marca?.toUpperCase();
    const articulos = await getFlexCacheMemory();

    const modelos = articulos
      .filter((a) => a?.marca?.descripcion?.toUpperCase() === marca)
      .map((m) => ({
        codigo: m.codigoarticulo,
        descripcion: m.descripcion,
      }));

    res.json({ data: modelos });
  } catch (e) {
    console.error("❌ Error admin/modelos:", e);
    res.status(500).json({ error: "Error obteniendo modelos" });
  }
});


// ===============================
// LISTA DE MOTOS
// ===============================
// ===============================
// LISTA DE MOTOS (SOLO MOTOS REALES)
// ===============================
app.get("/api/motos", async (req, res) => {
  try {
    let articulos = await getFlexCacheMemory();   // cache viejo
    const complements = readComplements();        // datos manuales

    if (!Array.isArray(articulos)) articulos = [];

    const MARCAS_MOTOS = [
      "BENELLI", "BAJAJ", "ZANELLA", "GILERA", "CORVEN",
      "MOTOMEL", "TVS", "HERO", "SUZUKI", "YAMAHA"
    ];

    const motos = articulos
      .filter(a => {
        const texto = (a.descripcion || "").trim().toUpperCase();

        if (!texto) return false;

        // ⚡ una moto REAL siempre empieza con la marca
        return MARCAS_MOTOS.some(marca => texto.startsWith(marca + " "));
      })
      .map(a => {
        const codigo = String(a.codigoarticulo || a.ID_ARTICULO || "").padStart(5, "0");
        const comp = complements[codigo] || {};

        return {
          codigo,
          descripcion: comp.descripcionExtra || a.descripcion || `Código ${codigo}`,
          marca: comp.marca || a.marca?.descripcion || "",
          precioFinal: comp.precioManual || Number(a.precioventa1 || 0) * 1.21,
          imagenPrincipal: comp.imagenPrincipal || "/imagenes/motos/default_moto.jpg",
          miniaturas: comp.miniaturas || [],
          fichaTecnica: comp.fichaTecnica || null
        };
      });

    console.log(`🏍️ MOTOS FILTRADAS: ${motos.length}`);

    res.json({ data: motos });

  } catch (err) {
    console.error("❌ ERROR en /api/motos:", err);
    res.status(500).json({ error: "Error al obtener motos" });
  }
});


// =======================================
// ACCESORIOS – CORREGIDO Y FINAL
// =======================================
// ===============================
// LISTA ACCESORIOS (VERSIÓN DEFINITIVA Y LIMPIA)
// ===============================
app.get("/api/accesorios", async (req, res) => {
  try {
    const articulos = await getFlexCacheMemory();
    const complements = readComplements();

    // Palabras clave extra por si algún accesorio viene mal categorizado
    const palabrasAccesorios = [
      "PORTA EQUIPAJE", "PORTAEQUIPAJE", "BOLSO",
      "PORTA CELULAR", "BAUL", "BAÚL",
      "PARABRISAS", "CUBRE", "DEFENSA",
      "SOPORTE", "ALFORJA"
    ];

    const listaAccesorios = articulos.filter(a => {
      const desc = (a.descripcion || "").toUpperCase();
      const superRubro = (a.descripcionsuperrubro || "").toUpperCase();
      const rubro = (a.descripcionrubro || "").toUpperCase();

      // 1️⃣ Primero: debe ser ACCESORIO por rubro
      const esAccesorioPorCategoria =
        superRubro.includes("ACCESORIO") ||
        rubro.includes("ACCESORIO");

      if (esAccesorioPorCategoria) return true;

      // 2️⃣ Si no está clasificado, probamos las palabras clave
      const esAccesorioPorPalabra =
        palabrasAccesorios.some(p => desc.includes(p));

      return esAccesorioPorPalabra;
    });

    const lista = listaAccesorios.map(a => {
      const codigo = String(a.codigoarticulo).trim();

      const comp =
        complements[codigo] ||
        complements[codigo.padStart(5, "0")] ||
        {};

      const precioFinal = +(Number(a.precioventa1 || 0) * 1.21).toFixed(2);

      return {
        codigo,
        descripcion: a.descripcion,
        marca: a.marca?.descripcion || "",
        tipo: "",
        precioFinal,
        imagenPrincipal:
          comp.imagenPrincipal || "/imagenes/img_logo/img_logo_fr.png",
        miniaturas: comp.miniaturas || []
      };
    });

    res.json({ ok: true, data: lista });

  } catch (err) {
    console.error("❌ ERROR /api/accesorios:", err);
    res.status(500).json({ error: "Error al obtener accesorios" });
  }
});


// ===============================
// DETALLE DE ACCESORIO (FINAL)
// ===============================
app.get("/api/accesorios/:codigo", async (req, res) => {
  try {
    const codigo = req.params.codigo.trim();

    const articulos = await getFlexCacheMemory();
    const complements = readComplements();

    const accesorio = articulos.find(
      a => String(a.codigoarticulo).trim() === codigo
    );

    if (!accesorio) {
      console.log("❌ No se encontró accesorio con código:", codigo);
      return res.json({ ok: false, error: "Accesorio no encontrado" });
    }

    const comp =
      complements[codigo] ||
      complements[codigo.padStart(5, "0")] ||
      {};

    const data = {
      ok: true,
      codigo,
      descripcion: accesorio.descripcion,
      marca: accesorio.marca?.descripcion || "",
      tipo: "",

      precioFinal: +(Number(accesorio.precioventa1 || 0) * 1.21).toFixed(2),

      imagenPrincipal:
        comp.imagenPrincipal || "/imagenes/img_logo/img_logo_fr.png",
      miniaturas: comp.miniaturas || [],
      fichaTecnica: comp.fichaTecnica || null
    };

    res.json(data);

  } catch (err) {
    console.error("❌ ERROR /api/accesorios/:codigo:", err);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

// ===============================
// LISTA INDUMENTARIA (VERSIÓN FINAL)
// ===============================
app.get("/api/indumentaria", async (req, res) => {
  try {
    // Traemos los artículos desde el cache (rápido y seguro)
    const articulos = await getFlexCacheMemory();
    const complements = readComplements();

    // Función para detectar talle
    const detectarTalle = (d = "") => {
      d = d.toUpperCase();
      const match = d.match(/TALLE\s+([A-Z0-9]+)/);
      return match ? match[1] : "";
    };

    // Filtrado por palabras clave reales de indumentaria
    const palabrasClave = [
      "CAMPERA","CHAQUETA","CAMISA","REMERA","PANTALON","PANTALÓN",
      "CALZA","BUZO","CAMISETA","BOTA","BOTAS","ZAPATILLA","ZAPATILLAS",
      "GUANTE","GUANTES","PARKA","JEAN","POLAR","INDUMENT","ROPA",
      "CHALECO","OVEROL"
    ];

    // Filtrar las prendas desde ARTICULOS
    const prendas = articulos.filter(a => {
      const desc = (a.descripcion || "").toUpperCase();
      return palabrasClave.some(p => desc.includes(p));
    });

    // Mapear resultado
    const lista = prendas.map(p => {
      const codigo = String(p.codigoarticulo).trim();

      const comp =
        complements[codigo] ||
        complements[codigo.padStart(5, "0")] ||
        {};

      const precioFinal = +(Number(p.precioventa1 || 0) * 1.21).toFixed(2);

      return {
        codigo,
        descripcion: p.descripcion,
        marca: p.marca?.descripcion || "",
        tipo: "",
        talle: detectarTalle(p.descripcion),
        precioFinal,
        imagenPrincipal:
          comp.imagenPrincipal || "/imagenes/img_logo/img_logo_fr.png",
        miniaturas: comp.miniaturas || []
      };
    });

    return res.json({ ok: true, data: lista });

  } catch (error) {
    console.error("❌ ERROR /api/indumentaria:", error);
    return res.status(500).json({ error: "Error al obtener indumentaria" });
  }
});

// ===============================
// DETALLE INDIVIDUAL DE INDUMENTARIA (CORREGIDO)
// ===============================
app.get("/api/indumentaria/:codigo", async (req, res) => {
  try {
    const codigo = req.params.codigo.trim(); // viene de codigoarticulo del listado

    // Traemos artículos desde el cache (igual que en el listado)
    const articulos = await getFlexCacheMemory();
    const complements = readComplements();

    // Buscar la prenda exacta por ID_ARTICULO (el que coincide con codigoarticulo)
    const prenda = articulos.find(
      (a) => String(a.codigoarticulo).trim() === codigo
    );

    if (!prenda) {
      console.log("❌ No se encontró prenda con código:", codigo);
      return res.json({ ok: false, error: "Producto no encontrado" });
    }

    const codigoArticulo = String(prenda.codigoarticulo).trim();

    // Complementos (imágenes, fichas técnicas)
    const comp =
      complements[codigoArticulo] ||
      complements[codigoArticulo.padStart(5, "0")] ||
      {};

    // Detectar variantes del mismo modelo
    const nombreBase = prenda.descripcion.split("TALLE")[0].trim().toUpperCase();
    const variantes = articulos.filter(a =>
      a.descripcion.toUpperCase().includes(nombreBase)
    );

    const data = {
      ok: true,
      codigo: codigoArticulo,
      descripcion: prenda.descripcion,
      marca: prenda.marca?.descripcion || "",
      tipo: "",
      talle: "",

      precioFinal: +(Number(prenda.precioventa1 || 0) * 1.21).toFixed(2),

      imagenPrincipal:
        comp.imagenPrincipal || "/imagenes/img_logo/img_logo_fr.png",
      miniaturas: comp.miniaturas || [],
      fichaTecnica: comp.fichaTecnica || null,

      variantes: variantes.map(v => ({
        codigo: String(v.codigoarticulo),
        descripcion: v.descripcion,
      }))
    };

    res.json(data);

  } catch (e) {
    console.error("❌ ERROR /api/indumentaria/:codigo", e);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});
// ===============================
// API REPUESTOS
// ===============================
app.get("/api/repuestos", async (req, res) => {
  try {
    let articulos = await getFlexCacheMemory();

    console.log("TOTAL PRODUCTOS FLEX:", articulos.length);

    const norm = (t) => (t || "").toUpperCase().trim();

    // 🟢 PALABRAS QUE INDICAN QUE ES REPUESTO
    const palabrasRepuestos = [
      // Aceites / lubricantes
      "ACEITE", "LUBRICANTE", "GRASA",

      // Filtros
      "FILTRO", "FILTRO AIRE", "FILTRO ACEITE", "FILTRO COMBUSTIBLE",

      // Retenes / juntas
      "RETEN", "RETÉN", "RETENES",
      "JUNTA", "JUNTAS", "JUEGO DE JUNTA", "JUEGO DE JUNTAS",

      // Motor
      "MOTOR", "PERNO", "PERNO PISTON", "PISTON", "PISTÓN",
      "CILINDRO", "AROS", "BIELA", "CIGUEÑAL", "CIGÜEÑAL",
      "VALVULA", "VÁLVULA", "VALVULAS", "VÁLVULAS",

      // Transmisión
      "CADENA", "CORONA", "PIÑON", "PIÑÓN", "KIT TRANSMISION",
      "TRANSMISION", "EMBRAGUE", "DISCO EMBRAGUE",

      // Frenos
      "FRENO", "PASTILLA", "PASTILLAS", "DISCO FRENO", "CAMPANA",

      // Eléctrico
      "BOBINA", "REGULADOR", "RECTIFICADOR", "CDI", "ECU",
      "RELÉ", "RELE", "ESTATOR", "ARRANQUE", "ENCENDIDO",

      // Alimentación / carburación
      "CARBURADOR", "CHICLER", "CHICLEUR", "AGUJA CARBURADOR",

      // Suspensión
      "AMORTIGUADOR", "BARRAL", "BARRALES",

      // Rodamientos
      "RULEMAN", "RULEMÁN", "RODAMIENTO",

      // Chasis / tablero
      "TABLERO", "INSTRUMENTO", "TABLERO INSTRUMENTO",
      "PEDAL", "POSAPIE", "POSAPIÉ", "CABALLETE", "CARENADO",
      "GUARDABARROS", "TAPON", "TAPÓN",

      // Combustible
      "BOMBA NAFTA", "BOMBA COMBUSTIBLE", "FLOTANTE",

      // Dirección
      "MANUBRIO", "CAZOLETA",

      // Otros
      "KIT MOTOR", "KIT REPARACION", "KIT REPARACIÓN"
    ];

    // 🟥 PALABRAS QUE QUEREMOS EXCLUIR (ACCESORIOS, INDUMENTARIA, ETC.)
    const palabrasAccesorios = [
      "BAUL", "BAÚL", "BAULERA", "PORTAEQUIPAJE",
      "BOLSO", "BOLSA", "CUBRE", "PROTECTOR",
      "CASCO", "ANTIPARRA", "LENTE", "GUANTE",
      "CAMPERA", "PANTALON", "PANTALÓN", "REMERA",
      "INDUMENTARIA"
    ];

    const repuestosFiltrados = articulos.filter((item) => {
      const desc = norm(item.descripcion);
      const grupo = norm(
        item.DESCRIPCIONGRUPOSUPERRUBRO || item.descripciongruposuperrubro
      );
      const superRubro = norm(
        item.DESCRIPCIONSUPERRUBRO || item.descripcionsuperrubro
      );
      const rubro = norm(
        item.DESCRIPCIONRUBRO || item.descripcionrubro
      );

      // Armamos un texto completo para buscar palabras
      const texto = `${desc} ${grupo} ${superRubro} ${rubro}`;

      // 1) Si parece accesorio → lo sacamos
      if (palabrasAccesorios.some((p) => texto.includes(p))) {
        return false;
      }

      // 2) Si Flexxus ya lo marca como REPUESTO → lo dejamos
      if (grupo.includes("REPUESTO")) {
        return true;
      }

      // 3) Si por palabras clave parece repuesto → lo dejamos
      if (palabrasRepuestos.some((p) => texto.includes(p))) {
        return true;
      }

      // Si no cumple nada → afuera
      return false;
    });

    // ===============================
    // COMPLEMENTS (IMÁGENES, ETC)
    // ===============================
    let complements = {};
    if (fs.existsSync(COMPLEMENTS_PATH)) {
      complements = JSON.parse(fs.readFileSync(COMPLEMENTS_PATH, "utf8"));
    }

    const dataFinal = repuestosFiltrados.map((item) => {
      const codigoArticulo = String(
        item.codigoarticulo ||
        item.CODIGO_PRODUCTO ||
        item.ID_ARTICULO ||
        ""
      ).trim();

      const extra =
        complements[codigoArticulo] ||
        complements[codigoArticulo.padStart(5, "0")] ||
        {};

      return {
        id: String(item.ID_ARTICULO || "").trim(),
        codigo: codigoArticulo,
        descripcion: item.descripcion,
        marca: item.marca?.descripcion || item.DESCRIPCION_MARCA || "",
        tipo: item.tipo || "",

        precioFinal: +(Number(item.precioventa1 || item.PRECIOVENTA || 0) * 1.21).toFixed(2),

        imagenPrincipal:
          extra.imagenPrincipal || "/imagenes/img_logo/img_logo_fr.png",
        miniaturas: extra.miniaturas || [],
      };
    });

    return res.json({ data: dataFinal });

  } catch (error) {
    console.error("❌ ERROR /api/repuestos:", error);
    return res
      .status(500)
      .json({ error: true, message: "Error obteniendo repuestos" });
  }
});
// ===============================
// DETALLE DE REPUESTO POR CÓDIGO
// ===============================
// ===============================
// DETALLE DE REPUESTO POR CÓDIGO
// ===============================
app.get("/api/repuestos/:codigo", async (req, res) => {
  try {
    const codigo = req.params.codigo.trim();

    const articulos = await getFlexCacheMemory();

    // Buscar por ID_ARTICULO exclusivamente
    // Buscar por cualquiera de los códigos posibles
const normalizar = (v = "") =>
  String(v).replace(/^0+/, "").trim();

const rep = articulos.find(a => {
  const idArticulo = normalizar(a.ID_ARTICULO);
  const codProd = normalizar(a.CODIGO_PRODUCTO);
  const codArt = normalizar(a.codigoarticulo);
  const buscado = normalizar(codigo);

  return buscado === idArticulo || buscado === codProd || buscado === codArt;
});



    if (!rep) {
      return res.json({ ok: false, error: "Repuesto no encontrado" });
    }

    // Complementos (imágenes)
    let complements = {};
    if (fs.existsSync(COMPLEMENTS_PATH)) {
      complements = JSON.parse(fs.readFileSync(COMPLEMENTS_PATH, "utf8"));
    }

    const extra =
      complements[codigo] ||
      complements[codigo.padStart(5, "0")] ||
      {};

    const data = {
      codigo,
      descripcion: rep.NOMBRE || rep.descripcion,
      rubro: rep.DESCRIPCIONRUBRO || "",
      marca: rep.DESCRIPCION_MARCA || "",
      precioFinal: +(Number(rep.PRECIOVENTA || rep.precioventa1 || 0) * 1.21).toFixed(2),

      // Imágenes
      imagenPrincipal: extra.imagenPrincipal || "/imagenes/img_logo/img_logo_fr.png",
      miniaturas: extra.miniaturas || [],
    };

    return res.json({ ok: true, data });

  } catch (error) {
    console.error("❌ Error detalle repuesto:", error);
    return res.status(500).json({
      ok: false,
      error: "Error obteniendo detalle de repuesto"
    });
  }
});


// ===============================
// CASCOS
// ===============================
function detectarTipoCasco(desc = "") {
  const d = desc.toUpperCase();
  if (d.includes("INTEGRAL")) return "Integral";
  if (d.includes("REBATIBLE")) return "Rebatible";
  if (d.includes("CROSS")) return "Cross";
  if (d.includes("ABIERTO")) return "Abierto";
  return "Otro";
}

app.get("/api/cascos", async (req, res) => {
  try {
    const articulos = await getFlexCacheMemory();
    const complements = readComplements(); // <-- AGREGADO

    const cascos = articulos.filter(a =>
      a.descripcion.toUpperCase().includes("CASCO")
    );

    const grupos = {};

    cascos.forEach(casco => {
      const desc = casco.descripcion.toUpperCase();

      const matchTalle = desc.match(/TALLE\s+([A-Z0-9]+)/);
      const talle = matchTalle ? matchTalle[1] : null;

      const modeloBase = desc.replace(/TALLE\s+[A-Z0-9]+/, "").trim();

      // Obtener complement del primer código posible
      const posibles = [
  casco.codigoarticulo,
  casco.codigoarticulo?.replace(/^0+/, ""),
  String(casco.codigoarticulo).padStart(5,"0")
];

const comp = posibles.map(p => complements[p]).find(Boolean) || {};


      if (!grupos[modeloBase]) {
        grupos[modeloBase] = {
          modelo: modeloBase,
          marca: casco.marca?.descripcion || "",
          precioBase: Number(casco.precioventa1) || 0,
          imagenPrincipal: comp.imagenPrincipal || "/imagenes/img_logo/img_logo_fr.png", // <-- AQUÍ VA LA FOTO
          talles: [],
          codigos: []
        };
      }

      if (talle) grupos[modeloBase].talles.push(talle);
      grupos[modeloBase].codigos.push(casco.codigoarticulo);
    });

    const resultado = Object.values(grupos).map(item => ({
      modelo: item.modelo,
      marca: item.marca,
      talles: item.talles,
      codigos: item.codigos,
      precioFinal: +(item.precioBase * 1.21).toFixed(2),
      imagenPrincipal: item.imagenPrincipal
    }));

    return res.json({ ok: true, data: resultado });

  } catch (error) {
    console.error("❌ Error en /api/cascos:", error);
    return res.status(500).json({ ok: false, error: "Error interno" });
  }
});

// ===============================
// DETALLE DE CASCO (CON VARIANTES)
// ===============================
app.get("/api/cascos/:codigo", async (req, res) => {
  try {
    const codigo = req.params.codigo?.trim();
    if (!codigo) return res.status(400).json({ error: "Falta código" });

    const articulos = await getFlexCacheMemory();

    // Normalizar códigos
    const normalizar = (str = "") =>
      String(str).toUpperCase().replace(/[^A-Z0-9]/g, "");

    const sinCeros = codigo.replace(/^0+/, "");
    const padded = sinCeros.padStart(5, "0");

    // Buscar casco exacto
    const casco = articulos.find(a =>
      [codigo, sinCeros, padded].some(c => normalizar(a.codigoarticulo) === normalizar(c))
    );

    if (!casco) return res.status(404).json({ error: "Casco no encontrado" });

    // Detectar talle
    const detectarTalle = (d = "") => {
      d = d.toUpperCase();
      const match = d.match(/TALLE\s+([A-Z0-9]+)/);
      return match ? match[1] : null;
    };

    const talleSeleccionado = detectarTalle(casco.descripcion);

    // → MODELO BASE (sin talle)
    const modeloBase = casco.descripcion.toUpperCase().replace(/TALLE\s+[A-Z0-9]+/, "").trim();

    // → Buscar TODAS las variantes que coinciden con el modelo base
    const variantes = articulos.filter(a =>
      a.descripcion.toUpperCase().includes(modeloBase)
    );

    // → Mapear talles y códigos
    const talles = variantes.map(v => detectarTalle(v.descripcion)).filter(Boolean);

    // → Colores detectados sacando palabras técnicas
    const detectarColor = (desc) => {
      let d = desc.toUpperCase();
      d = d.replace(modeloBase, "").trim();
      d = d.replace(/TALLE\s+[A-Z0-9]+/, "").trim();
      return d;
    };

    const colores = variantes.map(v => detectarColor(v.descripcion)).filter(Boolean);
    // Si no detectó colores → único color
    const coloresFinal = colores.length > 0 ? colores : ["Único color"];


    // Obtener imágenes desde complements
    const complements = readComplements();
    const comp =
      complements[casco.codigoarticulo] ||
      complements[codigo] ||
      complements[sinCeros] ||
      complements[padded] ||
      {};

    const precioFinal = +(Number(casco.precioventa1) * 1.21).toFixed(2);

    return res.json({
      ok: true,
      modelo: casco.descripcion,
      modeloBase,
      marca: casco.marca?.descripcion || "",
      codigo: casco.codigoarticulo,
      talle: talleSeleccionado,
      tallesDisponibles: talles,
      coloresDisponibles: coloresFinal,
      variantes: variantes.map(v => ({
        codigo: v.codigoarticulo,
        descripcion: v.descripcion
      })),
      imagen: comp.imagenPrincipal || DEFAULT_MOTO_IMAGE,
      miniaturas: comp.miniaturas || [],
      precioFinal
    });

  } catch (e) {
    console.error("❌ Error detalle casco:", e);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});
// ===============================
// 🔎 BUSCADOR GLOBAL
// ===============================
app.get("/api/buscar", async (req, res) => {
  const q = (req.query.q || "").toUpperCase().trim();

  if (!q) return res.json({ ok: true, resultados: [] });

  try {
    const articulos = await getFlexCacheMemory();

    // Normalizador
    const norm = t => (t || "").toUpperCase();

    // Filtrar coincidencias
    const encontrados = articulos.filter(a => {
      const desc = norm(a.descripcion || a.NOMBRE);
      const marca = norm(a.DESCRIPCION_MARCA);
      const rubro = norm(a.DESCRIPCIONRUBRO);

      return (
        desc.includes(q) ||
        marca.includes(q) ||
        rubro.includes(q)
      );
    });

    // Formato reducido (rápido para autocompletar)
    const resultados = encontrados.slice(0, 20).map(a => ({
      id: String(a.ID_ARTICULO || a.CODIGO_PRODUCTO || "").trim(),
      descripcion: a.descripcion || a.NOMBRE || "",
      categoria: a.DESCRIPCIONGRUPOSUPERRUBRO || "",
      marca: a.DESCRIPCION_MARCA || "",
    }));

    res.json({ ok: true, resultados });

  } catch (e) {
    console.error("❌ Error en /api/buscar:", e);
    res.json({ ok: false, resultados: [] });
  }
});

// ===============================
// SUBIR IMÁGENES
// ===============================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const categoria = (req.query.categoria || "otros").toString();
    const slug = (req.query.slug || "producto").toString();
    const dir = path.join(
  PUBLIC_HTML_PATH,
  "imagenes",
  categoria,
  slug
);


    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },

  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path
      .basename(file.originalname, ext)
      .replace(/[^a-z0-9-_]/gi, "_");

    cb(null, `${base}_${Date.now()}${ext}`);
  },
});

const upload = multer({ storage });

app.post("/api/upload",requireAdmin, upload.array("imagenes", 10), (req, res) => {
  const categoria = req.query.categoria;
  const slug = req.query.slug;

  const urls = req.files.map(
    (file) => `/imagenes/${categoria}/${slug}/${file.filename}`
  );

  res.json({ urls });
});

// ===============================
// SUBIR FICHAS TÉCNICAS (PDF)
// ===============================
const storagePDF = multer.diskStorage({
  destination: (req, file, cb) => {
    const codigo = req.query.codigo || "sin_codigo";
    const dir = path.join(PUBLIC_HTML_PATH, "fichas", codigo);

    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `ficha_${Date.now()}.pdf`);
  },
});

const uploadPDF = multer({ storage: storagePDF });

app.post("/api/upload-ficha", requireAdmin, uploadPDF.single("ficha"), (req, res) => {
  const codigo = req.query.codigo;

  if (!req.file)
    return res.status(400).json({ error: "No se subió archivo PDF" });

  const url = `/fichas/${codigo}/${req.file.filename}`;
  res.json({ ok: true, url });
});

// ===============================
// GUARDAR COMPLEMENTOS
// ===============================
app.post("/api/admin/complements", requireAdmin, (req, res) => {
  const c = req.body.codigoarticulo;
  if (!c) return res.status(400).json({ error: "Falta código" });

  const data = {
  imagenPrincipal: req.body.imagenPrincipal || null,
  miniaturas: Array.isArray(req.body.miniaturas) ? req.body.miniaturas : [],
  colores: Array.isArray(req.body.colores) ? req.body.colores : [],
  descripcionExtra: req.body.descripcionExtra || "",
  precioManual: req.body.precioManual || null,
  fichaTecnica: req.body.fichaTecnica || null,
};


  const saved = upsertComplement(c, data);
  res.json({ ok: true, data: saved });
});
// ===============================
// ENDPOINT UNIVERSAL PARA ADMIN
// ===============================
app.get("/api/admin/buscar", requireAdmin, async (req, res) => {
  try {
    const categoria = (req.query.categoria || "").toLowerCase();
    const marca = (req.query.marca || "").toUpperCase();
    const modelo = (req.query.modelo || "").toUpperCase();

    if (!categoria)
      return res.status(400).json({ ok: false, error: "Falta categoría" });

    let lista = [];

    if (categoria === "motos") {
      lista = (await getFlexCacheMemory()).filter(a =>
        ["MOTOMEL","BAJAJ","BENELLI","ZANELLA","TVS","HERO","GILERA","CORVEN","SUZUKI","YAMAHA"]
          .some(m => (a.descripcion || "").toUpperCase().startsWith(m))
      ).map(m => ({
        codigo: m.codigoarticulo,
        descripcion: m.descripcion,
        marca: m.marca?.descripcion || "",
        precioFinal: +(Number(m.precioventa1 || 0) * 1.21).toFixed(2),
        imagenPrincipal: readComplements()[m.codigoarticulo]?.imagenPrincipal || DEFAULT_MOTO_IMAGE
      }));
    }

    if (categoria === "cascos") {
      lista = (await getFlexCacheMemory()).filter(a =>
        (a.descripcion || "").toUpperCase().includes("CASCO")
      ).map(a => ({
        codigo: a.codigoarticulo,
        descripcion: a.descripcion,
        marca: a.marca?.descripcion || "",
        precioFinal: +(Number(a.precioventa1 || 0) * 1.21).toFixed(2),
        imagenPrincipal: readComplements()[a.codigoarticulo]?.imagenPrincipal || DEFAULT_MOTO_IMAGE
      }));
    }

    if (categoria === "accesorios") {
  lista = (await getAccesorios()).data || [];
}

if (categoria === "indumentaria") {
  lista = (await getIndumentaria()).data || [];
}

if (categoria === "repuestos") {
  lista = (await getRepuestos()).data || [];
}

    if (marca) lista = lista.filter(p => (p.marca || "").toUpperCase() === marca);
    if (modelo) lista = lista.filter(p => (p.descripcion || "").toUpperCase().includes(modelo));

    if (!lista.length)
      return res.json({ ok: false, error: "No se encontró el producto" });

    const prod = lista[0];

    return res.json({
      ok: true,
      data: {
        categoria,
        codigo: prod.codigo,
        descripcion: prod.descripcion,
        marca: prod.marca || "",
        precioFinal: prod.precioFinal || null,
        imagenPrincipal: prod.imagenPrincipal || null,
      }
    });

  } catch (e) {
    console.error("❌ ERROR /api/admin/buscar:", e);
    return res.status(500).json({ ok: false, error: "Error interno al buscar producto" });
  }
});

// ===============================
// API HOME CONTENT
// ===============================
app.get("/api/home-content", (req, res) => {
  try {
    const data = readHomeContent();
    res.json({ ok: true, data });
  } catch (e) {
    console.error("❌ Error /api/home-content:", e);
    res.status(500).json({ ok: false, error: "No se pudo cargar el contenido del home" });
  }
});

// ===============================
// API HOME DESTACADOS — CACHE INTELIGENTE
// ===============================
app.get("/api/home-destacados", async (req, res) => {
  try {
    const home = readHomeContent();
    const lista = Array.isArray(home.productosDestacados) ? home.productosDestacados : [];

    if (lista.length === 0) {
      return res.json({ ok: true, data: [] });
    }

    const cache = readDestacadosCache() || {};
const ahora = Date.now();
const CINCO_MINUTOS = 5 * 60 * 1000;

// 🛡 Cache válido solo si tiene estructura correcta
if (
  cache.lastUpdate &&
  Array.isArray(cache.items) &&
  cache.items.length > 0 &&
  ahora - cache.lastUpdate < CINCO_MINUTOS
) {
  console.log("⚡ Sirviendo destacados desde CACHE (instantáneo)");
  return res.json({ ok: true, data: cache.items });
}


    // ❗ Si NO hay caché o está viejo → consultar Flexxus UNA sola vez
    console.log("⏳ Cache vencido → Cargando desde Flexxus...");

    // 🔥 USAR CACHE FUNCIONAL, NO FLEXXUS DIRECTO
const articulos = await getFlexCacheMemory();

// Crear índice rápido desde cache
const normalizar = (v = "") =>
  String(v).replace(/^0+/, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const index = {};
for (const a of articulos) {
  const posibles = [
    a.codigoarticulo,
    String(a.codigoarticulo || "").replace(/^0+/, ""),
    String(a.codigoarticulo || "").padStart(5, "0"),
    a.ID_ARTICULO,
    a.CODIGO_PRODUCTO
  ];

  posibles.forEach(p => {
    const key = normalizar(p);
    if (key) index[key] = a;
  });
}

    const comps = readComplements();

const resultado = lista.map((item) => {
  const key = normalizar(item.codigo || "");

  const flex = index[key] || null;

  const codigoFinal = String(
    flex?.codigoarticulo || item.codigo || ""
  ).padStart(5, "0");

  const comp =
    comps[codigoFinal] ||
    comps[codigoFinal.replace(/^0+/, "")] ||
    {};

  const precioFlex = flex?.precioventa1
    ? Number(flex.precioventa1) * 1.21
    : null;

  return {
    categoria: item.categoria,
    codigo: codigoFinal,
    descripcion: flex?.descripcion || comp.descripcionExtra || `Código ${codigoFinal}`,
    marca: flex?.marca?.descripcion || comp.marca || "",
    precioFinal: comp.precioManual || precioFlex || 0,
    imagenPrincipal: comp.imagenPrincipal || "/imagenes/img_logo/img_logo_fr.png",
  };
});



    // 💾 Guardar nuevo caché
    writeDestacadosCache({ lastUpdate: ahora, items: resultado });

    res.json({ ok: true, data: resultado });

  } catch (err) {
    console.error("❌ Error en /api/home-destacados con caché:", err);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

app.post("/api/home-content", requireAdmin, (req, res) => {
  try {
    const nuevo = req.body;
    if (!nuevo) return res.status(400).json({ ok: false, error: "Datos inválidos" });

    const actual = readHomeContent();     // 👈 leemos lo actual
    const actualizado = {                 // 👈 merge para no borrar nada
      ...actual,
      ...nuevo
    };

    writeHomeContent(actualizado);
    // 🔥 Si se modifican productos destacados, invalidamos cache
if (req.body?.productosDestacados) {
  writeDestacadosCache({ lastUpdate: 0, items: [] });
  console.log("♻️ Cache de destacados invalidado desde admin");
}

    res.json({ ok: true, data: actualizado, message: "Contenido actualizado correctamente" });

  } catch (e) {
    console.error("❌ Error guardando home-content:", e);
    res.status(500).json({ ok: false, error: "No se pudo guardar el contenido" });
  }
});

// ===============================
// OBTENER CONTENIDOS DEL HOME
// ===============================
app.get("/api/contenidos", (req, res) => {
  try {
    const data = readHomeContent(); // 👈 CAMBIO CLAVE
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: "No se pudo leer contenidos del home" });
  }
});

// ===============================
// ACTUALIZAR CONTENIDOS DEL HOME
// ===============================
app.post("/api/contenidos", requireAdmin, (req, res) => {
  try {
    const nuevo = req.body;
    if (!nuevo) return res.status(400).json({ ok: false, error: "Datos inválidos" });

    const data = readHomeContent();
    const actualizado = { ...data, ...nuevo };

   writeHomeContent(actualizado);


    res.json({ ok: true, data: actualizado });

  } catch (e) {
    res.status(500).json({ ok: false, error: "No se pudo actualizar contenidos" });
  }
});
// ===============================
// BANNERS PRINCIPALES DEL HOME
// ===============================

// Obtener lista de banners
app.get("/api/contenidos/banners", (req, res) => {
 const data = readHomeContent();
  res.json({ ok: true, data: data.banners || [] });
});

// Agregar un banner
app.post("/api/contenidos/banners",requireAdmin
, (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ ok: false, error: "Falta URL del banner" });

  const data = readHomeContent();
  if (!Array.isArray(data.banners)) data.banners = [];

  data.banners.push(url);
  writeHomeContent(data);

  res.json({ ok: true, data: data.banners });
});

// Eliminar banner por índice
app.delete("/api/contenidos/banners/:index", (req, res) => {
  const index = Number(req.params.index);
 const data = readHomeContent();

  if (!Array.isArray(data.banners))
    return res.json({ ok: true, data: [] });

  if (isNaN(index) || index < 0 || index >= data.banners.length) {
    return res.status(400).json({ ok: false, error: "Índice inválido" });
  }

  data.banners.splice(index, 1);
  writeHomeContent(data);

  res.json({ ok: true, data: data.banners });
});

// ===============================
// SUBIR IMÁGENES DEL HOME
// ===============================
const storageHome = multer.diskStorage({
  destination: (req, file, cb) => {
    const tipo = req.query.tipo || "home";
    const dir = path.join(PUBLIC_HTML_PATH, "imagenes", "home", tipo);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}${ext}`);
  }
});

const uploadHome = multer({ storage: storageHome });

app.post("/api/upload-home", requireAdmin, uploadHome.single("imagen"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "No se subió imagen" });

  const tipo = req.query.tipo;
  const url = `/imagenes/home/${tipo}/${req.file.filename}`;

  res.json({ ok: true, url });
});
// =============================================================
// BANNER DE OFERTAS - SUBIR IMAGEN
// =============================================================
const storageOferta = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(PUBLIC_HTML_PATH, "imagenes", "home", "ofertas");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `oferta_${Date.now()}${ext}`);
  }
});

const uploadOferta = multer({ storage: storageOferta });

app.post("/api/upload/home/ofertas", requireAdmin, uploadOferta.single("imagen"), (req, res) => {
  if (!req.file)
    return res.status(400).json({ ok: false, error: "No se subió imagen" });

  const url = `/imagenes/home/ofertas/${req.file.filename}`;
  res.json({ ok: true, url });
});

// =============================================================
// BANNER DE OFERTAS - GUARDAR EN home_content.json
// =============================================================
app.post("/api/home/banner-ofertas", requireAdmin, (req, res) => {
  try {
    const data = readHomeContent();

    if (!data.bannerOfertas) data.bannerOfertas = {};

    data.bannerOfertas = {
      activo: true,
      imagen: req.body.imagen || data.bannerOfertas.imagen || "",
      titulo: req.body.titulo || "",
      boton: req.body.boton || "",
      link: req.body.link || "#"
    };

    writeHomeContent(data);

    res.json({ ok: true, data: data.bannerOfertas });

  } catch (e) {
    console.error("❌ Error guardando banner ofertas:", e);
    res.status(500).json({ ok: false, error: "No se pudo guardar el banner de ofertas" });
  }
});// ===============================
// SUBIR VIDEO DEL HOME
// ===============================
const storageVideo = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(PUBLIC_HTML_PATH, "imagenes", "home", "videos");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `video_${Date.now()}${ext}`);
  }
});

const uploadVideo = multer({ storage: storageVideo });

// Subir archivo .mp4
app.post("/api/upload/home/video", requireAdmin, uploadVideo.single("video"), (req, res) => {
  if (!req.file)
    return res.status(400).json({ ok: false, error: "No se subió video" });

  const url = `/imagenes/home/videos/${req.file.filename}`;
  res.json({ ok: true, url });
});

// Guardar info del video en home_content.json
app.post("/api/home/video", requireAdmin, (req, res) => {
  try {
    const data = readHomeContent();

    data.videoHome = {
      activo: true,
      archivo: req.body.archivo || data.videoHome?.archivo || "",
      titulo: req.body.titulo || "",
      subtitulo: req.body.subtitulo || "",
      link: req.body.link || "#"
    };

    writeHomeContent(data);

    res.json({ ok: true, data: data.videoHome });

  } catch (e) {
    console.error("❌ Error guardando video del home:", e);
    res.status(500).json({ ok: false, error: "No se pudo guardar el video" });
  }
});
// =============================================================
// BANNERS POR SECCIÓN (Motos, Cascos, Indumentaria, Accesorios, Repuestos)
// =============================================================

// 🔹 Carpeta: /public/imagenes/home/secciones/{categoria}
const storageSecciones = multer.diskStorage({
  destination: (req, file, cb) => {
    const cat = req.query.cat || "otros";
    const dir = path.join(PUBLIC_HTML_PATH, "imagenes", "home", "bannersSecciones", cat);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}${ext}`);
  }
});

const uploadSecciones = multer({ storage: storageSecciones });


// =============================================================
// 1) SUBIR una imagen para una sección
// =============================================================
app.post("/api/upload/home/bannersSecciones", requireAdmin, uploadSecciones.single("imagen"), (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ ok: false, error: "No se subió imagen" });

    const cat = req.query.cat;
    const url = `/imagenes/home/bannersSecciones/${cat}/${req.file.filename}`;

    return res.json({ ok: true, url });

  } catch (err) {
    console.error("❌ Error subiendo banner de sección:", err);
    res.status(500).json({ ok: false, error: "Error interno al subir banner de sección" });
  }
});


// =============================================================
// 2) GUARDAR banner de sección en home_content.json
// =============================================================
app.post("/api/home/seccion-banner", requireAdmin, (req, res) => {
  try {
    const { categoria, url } = req.body;

    if (!categoria || !url)
      return res.status(400).json({ ok: false, error: "Faltan datos (categoria, url)" });

    const data = readHomeContent();

    if (!data.bannersSecciones)
      data.bannersSecciones = {};

    data.bannersSecciones[categoria] = url;

    writeHomeContent(data);

    res.json({ ok: true, data: data.bannersSecciones });

  } catch (err) {
    console.error("❌ Error guardando banner de sección:", err);
    res.status(500).json({ ok: false, error: "Error interno al guardar banner" });
  }
});

// ===============================
// API TURNOS (guardar turno + calendar)
// ===============================
app.post("/api/turnos", async (req, res) => {
  try {
    const turno = req.body;

    // Guardar en MySQL
    const sql = `
      INSERT INTO turnos (nombre, telefono, email, marca, modelo, problema, fecha_turno, hora, estado)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente')
    `;

    await db.query(sql, [
      turno.nombre,
      turno.telefono,
      turno.email || "",
      turno.marca,
      turno.modelo,
      turno.problema,
      turno.fecha_turno,
      turno.hora
    ]);

    // Crear evento en Google Calendar
    const creado = await crearEventoCalendar(turno);

    return res.json({
      ok: true,
      message: "Turno guardado correctamente",
      calendar: creado
    });

  } catch (error) {
    console.error("❌ Error guardando turno:", error);
    res.status(500).json({ ok: false, error: "Error al guardar el turno" });
  }
});
async function crearEventoCalendar(turno) {
  try {
    const fecha = turno.fecha_turno;
    const hora = turno.hora;
    const dateTime = `${fecha}T${hora}:00`;

    const event = {
      summary: `Turno | ${turno.nombre}`,
      description:
        `Problema: ${turno.problema}\n` +
        `Tel: ${turno.telefono}\n` +
        `Email: ${turno.email}`,
      start: {
        dateTime: dateTime,
        timeZone: "America/Argentina/Buenos_Aires"
      },
      end: {
        dateTime: dateTime,
        timeZone: "America/Argentina/Buenos_Aires"
      },
      reminders: { useDefault: true }
    };

    const response = await calendar.events.insert({
      calendarId: "joa.isaguiirre@gmail.com",
      resource: event
    });

    console.log("📌 Evento creado:", response.data.htmlLink);
    return response.data;

  } catch (err) {
    console.error("❌ Error creando evento:", err);
    return null;
  }
}

// ===============================
// ADMIN: LISTAR TURNOS
// ===============================
app.get("/api/turnos", requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM turnos ORDER BY id DESC");
    res.json(rows);
  } catch (error) {
    console.error("❌ Error obteniendo turnos:", error);
    res.status(500).json({ error: "Error al cargar turnos" });
  }
});

// ===============================
// ADMIN: MARCAR ATENDIDO
// ===============================
app.put("/api/turnos/:id/atendido", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    await db.query("UPDATE turnos SET estado='Atendido' WHERE id = ?", [id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Error actualizando turno" });
  }
});

// ===============================
// ADMIN: ELIMINAR TURNO
// ===============================
app.delete("/api/turnos/:id", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    await db.query("DELETE FROM turnos WHERE id = ?", [id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Error eliminando turno" });
  }
});
// ============================================
// GUARDAR SUSCRIPTOR (NEWSLETTER)
// ============================================
app.post("/api/suscribir", async (req, res) => {
  const { email } = req.body;
  console.log("📩 Email recibido:", email);

  if (!email || email.trim() === "") {
    return res.status(400).json({ ok: false, error: "Email inválido" });
  }

  try {
    const sql = `INSERT INTO suscriptores (email) VALUES (?)`;
    const [result] = await db.execute(sql, [email]);

    return res.json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error("❌ Error guardando suscriptor:", err);
    return res.status(500).json({ ok: false, error: "Error interno del servidor" });
  }
});

// ============================================
// OBTENER LISTA DE SUSCRIPTORES
// ============================================
app.get("/api/suscriptores", requireAdmin, async (req, res) => {
  try {
    const sql = `SELECT * FROM suscriptores ORDER BY id DESC`;
    const [rows] = await db.execute(sql);

    return res.json({ ok: true, data: rows });

  } catch (err) {
    console.error("❌ Error obteniendo suscriptores:", err);
    return res.status(500).json({ ok: false, error: "Error interno del servidor" });
  }
});

// ============================================
// ELIMINAR SUSCRIPTOR
// ============================================
app.delete("/api/suscriptores/:id", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    await db.execute("DELETE FROM suscriptores WHERE id = ?", [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Error eliminando suscriptor:", err);
    res.status(500).json({ ok: false, error: "Error interno del servidor" });
  }
});


// =======================================================
// PRE-CARGAR CACHE DE DESTACADOS AL INICIAR EL SERVIDOR
// =======================================================
// =======================================================
// PRE-CARGAR CACHE DE DESTACADOS AL INICIAR EL SERVIDOR
// =======================================================
(async () => {
  try {
    console.log("⏳ Precargando destacados al iniciar servidor...");

    const home = readHomeContent();
    const lista = Array.isArray(home.productosDestacados)
      ? home.productosDestacados
      : [];

    if (lista.length === 0) {
      console.log("⚠ No hay productos destacados configurados.");
      return;
    }

    let articulos = [];

try {
  const resp = await flexGet(`/articulos?limit=5000`);
  articulos = resp?.data || [];
} catch (e) {
  console.warn("⚠ No se pudieron cargar destacados al iniciar. Se hará bajo demanda.");
  return;
}

    // 👉 CREAR INDEX CORRECTAMENTE
    const index = {};
    for (const a of articulos) {
      const cod = String(a.codigoarticulo || a.codigo || "").trim();
      if (cod) index[cod] = a;
    }

    const comps = readComplements();

    const resultado = lista.map(item => {
      const codigo = String(item.codigo || "").replace(/^0+/, "");

      const flex =
        index[codigo] ||
        index[codigo.padStart(5, "0")] ||
        null;

      const comp =
        comps[codigo] ||
        comps[codigo.padStart(5, "0")] ||
        {};

      const precioFlex = flex?.precioventa1
        ? Number(flex.precioventa1) * 1.21
        : 0;

      return {
        categoria: item.categoria,
        codigo,
        descripcion: flex?.descripcion || comp.descripcion || `Código ${codigo}`,
        marca: flex?.marca?.descripcion || comp.marca || "",
        precioFinal: comp.precioManual || precioFlex,
        imagenPrincipal:
          comp.imagenPrincipal || "/imagenes/img_logo/img_logo_fr.png",
      };
    });

    writeDestacadosCache({
      lastUpdate: Date.now(),
      items: resultado,
    });

    console.log("⚡ Cache de destacados precargado OK.");

  } catch (err) {
    console.error("❌ Error precargando destacados:", err);
  }
})();

// ===============================
// LOGIN ADMIN (DB)
// ===============================
app.post("/api/admin/login", async (req, res) => {
  const { user, pass } = req.body;

  if (!user || !pass) {
    return res.status(400).json({ ok: false, error: "Datos incompletos" });
  }

  try {
    const [rows] = await db.query(
      "SELECT id, usuario, password_hash, rol FROM admin_users WHERE usuario = ?",
      [user]
    );

    if (rows.length === 0) {
      return res.json({ ok: false, error: "Usuario incorrecto" });
    }

    const admin = rows[0];

    // 🔴 Por ahora comparación directa (después encriptamos)
    // ✅ Comparación segura con bcrypt

const match = await bcrypt.compare(pass, admin.password_hash);
if (!match) {
  return res.json({ ok: false, error: "Contraseña incorrecta" });
}

    // 🔐 Crear token JWT
const token = jwt.sign(
  {
    id: admin.id,
    usuario: admin.usuario,
    rol: admin.rol
  },
  process.env.ADMIN_JWT_SECRET,
  { expiresIn: "2h" }
);

// 🍪 Enviar cookie segura
res.cookie("admin_token", token, {
  httpOnly: true,
  sameSite: "none",
  secure: true,
  maxAge: 2 * 60 * 60 * 1000 // 2 horas
});

res.json({
  ok: true,
  user: {
    id: admin.id,
    usuario: admin.usuario,
    rol: admin.rol
  }
});


  } catch (err) {
    console.error("❌ Error login admin:", err);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

// ===============================
// LOGOUT ADMIN
// ===============================
app.post("/api/admin/logout", (req, res) => {
 res.clearCookie("admin_token", {
  httpOnly: true,
  sameSite: "none",
  secure: true
});


  res.json({ ok: true });
});

// ===============================
// SERVIDOR
// ===============================
const PORT = process.env.PORT || 3200;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor Frontera escuchando en puerto ${PORT}`);
});
