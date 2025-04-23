-- Script de réinitialisation de la base de données

-- Supprimer la table si elle existe
DROP TABLE IF EXISTS cities CASCADE;

-- Supprimer la vue si elle existe
DROP VIEW IF EXISTS popular_cities;

-- Exécuter le script d'initialisation
\i db/init/init_cities_db.sql