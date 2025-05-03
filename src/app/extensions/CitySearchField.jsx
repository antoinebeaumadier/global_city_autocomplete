import React, { useState, useEffect, useRef } from 'react';
import './CitySearchField.css';

const CitySearchField = ({ field }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedCity, setSelectedCity] = useState(null);
  const dropdownRef = useRef(null);

  // Handle clicks outside the dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search
  useEffect(() => {
    const searchCities = async () => {
      if (searchTerm.length < 2) {
        setResults([]);
        return;
      }

      setIsLoading(true);
      try {
        const response = await fetch(`/api/cities/search?q=${encodeURIComponent(searchTerm)}`);
        const data = await response.json();
        setResults(data);
        setShowDropdown(true);
      } catch (error) {
        console.error('Error searching cities:', error);
      } finally {
        setIsLoading(false);
      }
    };

    const timer = setTimeout(searchCities, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const handleSelectCity = (city) => {
    setSelectedCity(city);
    setSearchTerm(city.name);
    setShowDropdown(false);
    
    // Update the HubSpot form field value
    const cityData = `${city.name}, ${city.state}, ${city.country}`;
    field.setValue(cityData);
  };

  return (
    <div className="city-search-container" ref={dropdownRef}>
      <input
        type="text"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="Search for a city..."
        className="hs-input"
        style={{ width: '100%', padding: '8px' }}
      />
      
      {isLoading && (
        <div className="loading-indicator">Loading...</div>
      )}

      {showDropdown && results.length > 0 && (
        <div className="city-dropdown">
          {results.map((city) => (
            <div
              key={`${city.name}-${city.state}-${city.country}`}
              className="city-option"
              onClick={() => handleSelectCity(city)}
              style={{
                padding: '8px',
                cursor: 'pointer',
                borderBottom: '1px solid #eee'
              }}
            >
              {city.name}, {city.state}, {city.country}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CitySearchField; 