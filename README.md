# Go Store

**Una forma sencilla y gratuita de llevar un emprendimiento a la web.**

## Visión

Muchos emprendimientos ofrecen sus productos o servicios de manera informal a través de canales como WhatsApp o Telegram, sin una página web ordenada que presente su propuesta. Esto puede reducir su visibilidad, dificultar que nuevos clientes encuentren lo que ofrecen y hacer que se pierdan oportunidades de venta.

Go Store busca ayudar a cerrar esa brecha. La plataforma permitirá que cualquier persona pueda crear una tienda web sencilla, clara y efectiva para su emprendimiento, sin conocimientos de programación ni de infraestructura.

Con una guía paso a paso, cada emprendedor podrá personalizar su tienda, ordenar su catálogo de productos o servicios y dejarla lista para que sus clientes conozcan su oferta y realicen pedidos.

Go Store está pensada para quienes recién comienzan: **crear y editar una tienda no tendrá costo**. El proyecto es de código abierto y busca que más emprendimientos puedan tener una presencia web profesional desde el inicio.

## Cómo imaginamos Go Store

- Un recorrido guiado para crear y publicar una tienda.
- Edición sencilla de la marca, el logo, los colores, la portada y la información del negocio.
- Gestión de productos o servicios, categorías, precios, fotos y disponibilidad.
- Una tienda pública con una presentación ordenada y adaptable a teléfonos y computadoras.
- Un panel simple para atender y gestionar pedidos.
- Plantillas que den un buen punto de partida y permitan personalizar sin programar.

## Estado del proyecto

Go Store está en una etapa inicial. Este repositorio conserva **Grano Vivo** como prototipo visual de una tienda de ejemplo. El creador de tiendas todavía es el siguiente hito; el prototipo actual no tiene registro real, pedidos persistentes ni pagos conectados.

## Probar la tienda de ejemplo

Sirve `examples/grano-vivo-demo/` con cualquier servidor estático. Por ejemplo, con Python:

```bash
python -m http.server 8000 --directory examples/grano-vivo-demo
```

Luego abre `http://localhost:8000`.

Los productos y pedidos son ficticios y se guardan solo durante la sesión del navegador. La demo no envía emails ni recibe pagos.

## Próximos pasos

1. Crear el recorrido de registro por email y puesta en marcha de una tienda.
2. Construir el editor guiado de marca y catálogo con vista previa.
3. Añadir inicio de sesión y guardado persistente de la información de cada negocio.
4. Publicar tiendas y habilitar la gestión real de pedidos.
5. Incorporar pagos y notificaciones como integraciones optativas.

## Licencia

Go Store se distribuye bajo la licencia Apache 2.0. Consulta [`LICENSE`](LICENSE).
