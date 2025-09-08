[1mdiff --git a/docker-compose.dev-https.yaml b/docker-compose.dev-https.yaml[m
[1mindex bbc7dd8..9e34e64 100644[m
[1m--- a/docker-compose.dev-https.yaml[m
[1m+++ b/docker-compose.dev-https.yaml[m
[36m@@ -1,10 +1,10 @@[m
[32m+[m
 #version: '3.8'[m
 [m
 services:[m
   app-dev-https:[m
     image: bolt-ai:development[m
     build:[m
[31m-      context: .[m
       target: bolt-ai-development[m
     env_file: '.env'[m
     environment:[m
[36m@@ -59,3 +59,5 @@[m [mservices:[m
       - app-dev-https[m
     profiles: ['development-https'][m
 [m
[41m+[m
[41m+[m
