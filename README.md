<div align="center">
  
# <span style="color: #E5E7EB;">F</span><span style="color: #E53935;">T</span> FuelTech Master

**Consulta Técnica de Módulos y Pilas de Gasolina para Talleres Mecánicos**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-success)](https://nodejs.org/)
[![SQLite](https://img.shields.io/badge/Database-SQLite3-003B57?logo=sqlite)](https://www.sqlite.org/)
[![Render](https://img.shields.io/badge/Deploy-Render-46E3B7?logo=render)](https://render.com/)

</div>

---

**FuelTech Master** es una herramienta técnica desarrollada para talleres de reparación automotriz. Permite a mecánicos y técnicos consultar rápidamente la presión de riel (PSI/Bar) adecuada, ubicar módulos de combustible y encontrar pilas (bombas) OEM y alternativas compatibles para más de 140 vehículos del mercado mexicano.

## 🚀 Funcionalidades Principales

*   **🔍 Motor de Búsqueda Ultra Rápido:** Filtra por marca, modelo, año y tipo de inyección en milisegundos.
*   **📊 Especificaciones Precisas (OEM):** Datos técnicos de presión máxima de trabajo, litraje por hora (LPH) y amperaje.
*   **⚙️ Visor 3D Interactivo:** Visualiza representaciones 3D de distintos modelos de bombas mediante *Three.js* integrado.
*   **🤖 Asistente de IA (Gemini):** Chatbot incorporado entrenado exclusivamente con contexto de inyección y sistemas de combustible para diagnóstico inteligente. *(Requiere API Key)*.
*   **🔒 Privacidad y Seguridad:** Arquitectura robusta *Offline-first / SQLite* resistente a SQL Injection, con control de límites de peticiones (Rate Limit).
*   **🌐 Cero Dependencias Externas (Frontend):** Bibliotecas como React, ReactDOM y Three.js se sirven localmente desde `/vendor/` para máxima velocidad y fiabilidad sin depender de CDNs (unpkg).

## 🛠️ Tecnologías

*   **Backend:** Node.js, Express, `better-sqlite3`.
*   **Frontend:** HTML5, CSS Nativo (Glassmorphism), Vanilla JS y HTM (Hyperscript Tagged Markup) con React.
*   **Gráficos 3D:** Three.js.
*   **Seguridad:** Helmet, express-rate-limit.

## ⚙️ Instalación Local

1.  **Clona el repositorio:**
    ```bash
    git clone https://github.com/Gustav0H2O/fueltech.git
    cd fueltech
    ```

2.  **Instala las dependencias:**
    ```bash
    npm install
    ```

3.  **Genera la base de datos (Semilla):**
    ```bash
    npm run seed
    ```

4.  **Ejecuta el servidor:**
    ```bash
    npm start
    ```
    > El servidor estará disponible en `http://localhost:3000`.

## ☁️ Despliegue en Producción (Render)

El proyecto incluye un archivo `render.yaml` listo para despliegue automatizado.

1.  Conecta este repositorio en tu cuenta de **Render**.
2.  Despliega usando la configuración provista en el YAML.
3.  **Importante (Chat IA):** Agrega la variable de entorno `GEMINI_API_KEY` con tu llave generada en Google AI Studio dentro de las variables de entorno de tu Web Service en Render para activar el Chatbot.

> [!WARNING]
> Nunca incluyas tu `GEMINI_API_KEY` directamente en el código fuente. Utiliza siempre variables de entorno.

## 🤝 Contribución

¡Las pull requests son bienvenidas! Si tienes datos precisos de manual de servicio sobre presiones de riel de otros vehículos o catálogos de repuestos alternativos, siéntete libre de abrir un issue o contribuir al archivo `seed.js`.

---
<div align="center">
  <sub>Desarrollado con pasión para la comunidad mecánica y automotriz. 🚗💨</sub>
</div>
