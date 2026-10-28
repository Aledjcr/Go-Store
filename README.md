# Go Store

Plataforma de código abierto para que una persona pueda crear, personalizar y operar su tienda online sin programar.

> **Estado:** en etapa inicial. Este repositorio conserva el prototipo de tienda Grano Vivo como ejemplo visual. El creador de tiendas todavía es el siguiente hito; aún no hay registro real, persistencia de pedidos ni pagos conectados.

## Objetivo

Go Store permitirá registrarse con email y comenzar a personalizar una tienda desde un editor guiado: marca y logo, portada, categorías, productos, precios, fotos, disponibilidad y opciones de retiro o entrega. La misma aplicación publicará la tienda para clientes y ofrecerá un panel para gestionar pedidos.

## Qué incluye hoy

- `examples/grano-vivo-demo/`: prototipo estático del recorrido de tienda para una marca gastronómica de ejemplo.
- Interfaz de menú, búsqueda, carrito, checkout y panel de demostración.
- Fotos de packaging generadas para el prototipo.

Los productos y pedidos de esta demo son ficticios y se guardan solo durante la sesión del navegador. No envía emails ni recibe pagos.

## Ejecutar la demo

Sirve `examples/grano-vivo-demo/` con cualquier servidor estático. Por ejemplo, con Python:

```bash
python -m http.server 8000 --directory examples/grano-vivo-demo
```

Luego abre `http://localhost:8000`.

## Próximos hitos

1. Prototipo navegable de registro por email y creación de una tienda.
2. Editor sencillo de marca y catálogo con vista previa en vivo.
3. Autenticación real y guardado persistente de tiendas y productos.
4. Publicación de tiendas y gestión real de pedidos.
5. Pagos y notificaciones como integraciones optativas.

## Principios

- Código abierto y despliegue documentado.
- Personalización sin código, con plantillas y bloques acotados.
- Una sola aplicación para muchas tiendas, con aislamiento de datos por comercio.
- La tienda ejemplo Grano Vivo sirve como plantilla inicial, no define la marca de Go Store.

## Licencia

Este proyecto se distribuye bajo Apache License 2.0. Consulta [`LICENSE`](LICENSE).
