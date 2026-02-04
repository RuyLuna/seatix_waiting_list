# Seatix Waitlist API

### Descripción general ###
Implementación de una API de lista de espera para un sistema de venta de boletos,
para solucionar el problema de usuarios que no se enteran cuando hay boletos
disponibles lo que se traduce en pérdida de ventas.

Hecha en Node.JS con Express, utilizando Redis para agilizar la operación de notificar a los usuarios
e implementar colas y workers mediante BullMQ (Similar a RabbitMQ pero trabajando directamente con nuestra instancia de Redis) con SQLite como un almacenamiento de datos persistente de fácil implementación, en una implementación real se podría utilizar una solución diferente como PostgreSQL.


### Instrucciones de cómo correr el proyecto ###
Tener docker instalado
Utilizar docker compose en la carpeta del repositorio
    docker compose up --build
para crear el contenedor con los servicios de redis y la api.
SQLite se almacena automáticamente en un archivo .db dentro de la carpeta data.

Para probar el proyecto se pueden utilizar herramientas como redis insight para conectarse a la instancia de redis que tenemos en docker y DB Browser for SQLite si queremos ver lo que está ocurriendo en SQLite.

La api debería estar disponible en: http://localhost:3000

Por motivos de pruebas, las API Keys se crean automáticamente al iniciar la aplicación
    sk_test_user_12345 - User role
    sk_test_promoter_abc123 - Promoter (owns concert-123)
    sk_test_promoter_xyz789 - Promoter (owns concert-456)
    sk_test_admin_000000 - Admin (full access)

### ARQUITECTURA Y FLUJO ###
En redis las colas están divididas por zona (VIP, General, etc) para facilitar la operación de agregar y quitar usuarios de la cola, esta estructura puede ser aprovechada para mantener el orden FIFO.

Redis está configurado con persistencia de datos, pero si este llegara a fallar la aplicación recrea las colas con los datos de SQLite al iniciarse.

Flujo normal:
    Usuario se registra -> Se añade a la cola -> Se liberan los tickets -> Se notifica al usuario
    Si el usuario acepta la oferta, se actualiza SQLite con estado "accepted"
    Si redis elimina la oferta (Gracias al TTL) el listener (offerExpirationListener.js) actualiza el estado en SQLite y regresa al usuario a la lista de espera


### EJEMPLO DE ENDPOINTS ###
# Probar que la API este funcionando correctamente:
curl -X GET 'http://localhost:3000/waitlist/' \
  --header 'User-Agent: yaak' \
  --header 'Accept: */*'

# Ver la posición de un usuario
curl -X GET 'http://localhost:3000/waitlist/events/concert-123/waitlist/me' \
  --header 'User-Agent: yaak' \
  --header 'Accept: */*' \
  --header 'X-API-Key: sk_test_promoter_xyz789' \
  --header 'x-user-id: Ruy'

# Agregar usuario a lista de espera
curl -X POST 'http://localhost:3000/waitlist/events/concert-123/waitlist' \
  --header 'User-Agent: yaak' \
  --header 'Accept: */*' \
  --header 'Content-Type: application/json' \
  --header 'X-API-Key: sk_test_user_12345' \
  --data '{"user_id":"Ruy","zones_preferred":["General"],"quantity_wanted":2}'

# Eliminar usuario de lista de espera
curl -X DELETE 'http://localhost:3000/waitlist/events/concert-123/waitlist/me' \
  --header 'User-Agent: yaak' \
  --header 'Accept: */*' \
  --header 'X-API-Key: sk_test_user_12345' \
  --header 'x-user-id: Ruy'

# Ver lista de espera como proveedor
curl -X GET 'http://localhost:3000/providers/concert-123/waitlist' \
  --header 'User-Agent: yaak' \
  --header 'Accept: */*' \
  --header 'X-API-Key: sk_test_promoter_abc123'

# Liberar tickets
curl -X POST 'http://localhost:3000/waitlist/events/concert-123/release-tickets' \
  --header 'User-Agent: yaak' \
  --header 'Accept: */*' \
  --header 'Content-Type: application/json' \
  --header 'X-API-Key: sk_test_promoter_abc123' \
  --data '{"zones":{"VIP":3,"General":5},"reason":"cancellation"}'

Este endpoint libera los tickets para un evento y crea un trabajo, el worker (tickerWorker.js)
procesa este trabajo donde, por zona, busca la cola en redis correspondiente y crea o no la oferta
dependiendo si hay usuarios validos para los tickets que fueron liberados.

# Aceptar oferta
curl -X POST 'http://localhost:3000/waitlist/offers/YOUR_TOKEN_HERE/accept' \
  --header 'User-Agent: yaak' \
  --header 'Accept: */*' \
  --header 'Content-Type: application/json' \
  --header 'X-API-Key: sk_test_user_12345'

### Para aceptar una oferta ###
El endpoint de aceptar oferta requiere el token que fue creado automáticamente (con un tiempo de vida de 10 minutos) cuando se liberaron tickets. Para obtener este token hay dos maneras:
    Ver los logs en la consola de docker y localizar el token
    Ver los datos en redis y buscar los tokens en la ruta de "offers"
Los tokens no están guardados permanentemente en SQLite pero si un token expira el usuario vuelve a la lista de espera (Véase archivo src/workers/offerExpirationListener.js)

### Siguientes pasos ###
Si este proyecto fuera real, para completarlo se pudiera realizar lo siguiente:
    Una autenticación real, bien implementada con manejo de roles
    Separación de api y workers para un escalado diferente entre servicios
    Funcionalidad de actualizar una entrada en la lista de espera de un usuario
    Una implementación más realista sobre los tickets y eventos

# Conclusiones
Agradecimientos al equipo de Seatix/Lizos Music, espero que este proyecto cumpla sus expectativas.
Sin duda aprendí cosas nuevas y el problema a resolver fue interesante.
Saludos.

# Autor: Ruy Luna














