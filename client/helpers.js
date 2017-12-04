import moment from 'moment';
import mapboxgl from 'mapbox-gl';
import { mapDirection } from './store/index';
mapboxgl.accessToken = process.env.mapboxKey;
import axios from 'axios';

export function timer(createdAt) {
  return moment().startOf(createdAt).fromNow()
}

export function timeSince(createdAt, type) {
  //Returns time since now and the item created
  //Default is milliseconds
  let now = moment();
  let created = moment(createdAt);
  if (type === 'sec') return now.diff(created)/1000
  if (type === 'min') return (now.diff(created)/1000)/60
  return now.diff(created)
}

export function getUserLocation(options) {
  return new Promise(function (resolve, reject) {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}
/*Filter in Filter.js ==========================*/
export function filterSpots(filter, spots) {
  return Object.keys(filter).length < 1 ? spots : spots.filter(spot => {
    for (var key in filter) {
      if (key === 'timeAvailable'){
        if (timeSince(spot.properties.createdAt, 'min') <= filter[key][0]){
          return true;
        }
      }
      if (key === 'distance'){
        if (spot.distanceFromOrigin <= filter[key][0]){
          return true;
        }
      }
      if (filter[key].includes(spot.properties[key])) {
        return true;
      }
      return false;
    }
  });
}

//Below's function calculates the distance from two geo points as the crow flies or straight-line distance
//Uses the Haversine Formula. More info: https://en.wikipedia.org/wiki/Haversine_formula
//As well as this stack: https://stackoverflow.com/questions/18883601/function-to-calculate-distance-between-two-coordinates-shows-wrong
//We may consider switching this to Google's API
export function getDistanceFromLatLng(lat1, lon1, lat2, lon2) {
  var R = 6371; // Radius of the earth in km
  var dLat = deg2rad(lat2 - lat1);  // deg2rad below
  var dLon = deg2rad(lon2 - lon1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
    ;
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  var d = R * c; // Distance in km
  return round(d, 2);
}
//Mini function used in above formula
function deg2rad(deg) {
  return deg * (Math.PI / 180)
}
//Mini function used in above formula
function round(value, decimals) {
  return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
}


// helper functions for spot validation
function fetchGoogleAddress(coor) {
  const [lng, lat] = coor;
  const queryString = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_DISTANCE_SECRET}`;
  return axios.get(queryString)
    .then(result => result.data.results[0])
}

function reverseGoogleAddress(current, cross) {
  const queryAddress = `${current} and ${cross}, new york, new york`.split(' ').join('+');
  const queryString = `https://maps.googleapis.com/maps/api/geocode/json?address=${queryAddress}&key=${GOOGLE_DISTANCE_SECRET}`;
  return axios.get(queryString)
    .then(result => result.data.results[0])
    .then(results => {
      if (results) {
        results.currentStreet = current;
        results.intersectStreet = cross;
      }
      return results;
    })
}

function getIntersectionDistance(ori, dest, currStreet, crossStreet) {
  const _ori = ori.replace('&', 'and');
  const _dest = dest.replace('&', 'and');
  return axios.put('/api/intersections/distance', { origin: _ori, destination: _dest, mode: 'walking' })
    .then(result => result.data.rows[0])
    .then(distanceObj => {
      distanceObj.currentStreet = currStreet;
      distanceObj.crossStreet = crossStreet;
      return distanceObj;
    })
}

export function getDrivingDistance(origin, destination) {
  const [orgLong, orgLat] = origin;
  const [destLong, destLat] = destination;
  return axios.put('/api/distance/', { origin: `${orgLat},${orgLong}`, destination: `${destLat},${destLong}`, mode: 'driving' })
    .then(result => result.data.rows[0])
    .then(distanceObj => {
      return distanceObj.elements[0].distance;
    });
}

export function compareByDistance(spot1, spot2){
  return spot1.distanceFromOrigin.value - spot2.distanceFromOrigin.value;

}

function parseFtAndMile(str) {
  const arr = str.split(' ');
  if (arr[1] == 'mi') {
    return parseFloat(arr[0]) * 5280;
  }
  return parseFloat(arr[0]);
}

function findClosestStreets(tempArr) {
  const longestDistance = parseFtAndMile(tempArr[1].elements[0].distance.text);
  console.log('the longest distance: ', longestDistance);
  // validate longest distance
  const onStreet = tempArr[0].currentStreet;
  const street1 = tempArr[0].crossStreet;
  const street2 = tempArr[1].crossStreet;
  const origin = `${onStreet} and ${street1}, new york, new york`.split(' ').join('.');
  const destination = `${onStreet} and ${street2}, new york, new york`.split(' ').join('.');
  return getIntersectionDistance(origin, destination)
    .then(distanceObj => {
      const sectionLength = parseFtAndMile(distanceObj.elements[0].distance.text);
      console.log('the longest distance should be smaller than', sectionLength);
      return sectionLength >= longestDistance;
    })
}

function getIntersections(standOnStreet) {
  return axios.get(`/api/intersections/${standOnStreet}`)
    .then(result => result.data)
    .then(intersections => {
      console.log('all intersections: ', intersections);
      // query google geocoding api to find coor of all intersection
      return Promise.all(
        intersections.map(section => {
          return reverseGoogleAddress(section.currentStreet, section.intersectStreet)
        }))
    })
}

export function spotValidation(coor) {
  let standPoint;
  let distanceToClosestStreet;
  let distanceToFarStreet;
  let allsigns = [];
  let allsigns2 = [];
  let mainStreet, crossStreet1, crossStreet2, fromS, gotoS;
  return fetchGoogleAddress(coor)
    .then(place => {
      console.log('current locaiton: ', place);
      standPoint = place.formatted_address;
      const currentOn = place.address_components[1].long_name.toUpperCase();
      return getIntersections(currentOn)
        .then(streetsAndCoords => {
          console.log('streets and coord: ', streetsAndCoords);
          streetsAndCoords = streetsAndCoords.filter(ele => ele !== undefined);
          const origins = standPoint.split(' ').join('+');
          return Promise.all(
            streetsAndCoords.map(dest => {
              const destination = dest.formatted_address.split(' ').join('+');
              return getIntersectionDistance(origins, destination, dest.currentStreet, dest.intersectStreet);
            }))
        })
        .then(distances => {

          if (distances.length > 2) {
            distances.sort(function (aDist, bDist) {
              return aDist.elements[0].distance.value - bDist.elements[0].distance.value
            })
            console.log('sort by distances: ', distances);
            distanceToClosestStreet = parseFtAndMile(distances[0].elements[0].distance.text);

            // if (distances.length > 3)
            const onStreet = distances[0].currentStreet;
            const street1 = distances[0].crossStreet;
            const street2 = distances[1].crossStreet;
            const street3 = distances[2].crossStreet;

            // find the cloest two streets
            return findClosestStreets(distances)
              .then(bool => {
                if (bool) {
                  console.log(`you are on ${onStreet} between ${street1} and ${street2}`)
                  distanceToFarStreet = parseFtAndMile(distances[1].elements[0].distance.text);
                  mainStreet = onStreet;
                  crossStreet1 = street1;
                  crossStreet2 = street2;
                  return axios.put('/api/rules', { mainStreet, crossStreet1, crossStreet2 })
                    .then(result => result.data);
                } else {
                  console.log(`you are on ${onStreet} between ${street1} and ${street3}`)
                  distanceToFarStreet = parseFtAndMile(distances[2].elements[0].distance.text);
                  mainStreet = onStreet;
                  crossStreet1 = street1;
                  crossStreet2 = street3;
                  return axios.put('/api/rules', { mainStreet, crossStreet1, crossStreet2 })
                    .then(result => result.data);
                }
              })
              .then(signsFromCloseToFar => {
                if (signsFromCloseToFar.length > 0) {
                  fromS = crossStreet1;
                  gotoS = crossStreet2;
                }
                const rangeSmall = distanceToClosestStreet - 50 > 0 ? distanceToClosestStreet - 50 : 0;
                const rangeBig = distanceToClosestStreet + 50;
                console.log(`the accuracy is between ${rangeSmall}ft and ${rangeBig}ft`);
                // find remove the signs smaller than lower limit
                signsFromCloseToFar.forEach(signs => {
                  let side;
                  for (var i = 0; i < signs.length; i++) {
                    if (["W", "E", "N", "S"].includes(signs[i].side.trim())) {
                      side = signs[i].side.trim();
                      break
                    }
                  }
                  signs.forEach(sign => {
                    sign.side = side;
                    sign.fromStreet = fromS;
                    sign.gotoStreet = gotoS;
                  });
                  allsigns = allsigns.concat(signs.filter(sign => parseInt(sign.distance) >= rangeSmall))
                });
                if (allsigns.length > 0) {
                  // sort by distance
                  allsigns.sort(function (aSign, bSign) {
                    return parseInt(aSign.distance) - parseInt(bSign.distance);
                  })
                } else {
                  allsigns = [];
                }
                console.log('sorted signs:', allsigns);
                // find the upper limit
                let upperlimit;
                for (var i = 0; i < allsigns.length; i++) {
                  const newDistance = parseInt(allsigns[i].distance);
                  if (newDistance === rangeBig) {
                    upperlimit = rangeBig;
                    break;
                  } else if (newDistance > rangeBig) {
                    upperlimit = newDistance;
                    break;
                  }
                }
                upperlimit = upperlimit <= rangeBig ? rangeBig : upperlimit;
                allsigns = allsigns.filter(sign => parseInt(sign.distance) <= upperlimit)
                return allsigns;
              })
              .then(() => {
                return axios.put('/api/rules', {
                  mainStreet: mainStreet,
                  crossStreet1: crossStreet2,
                  crossStreet2: crossStreet1
                })
                  .then(result => result.data);
              })
              .then(signsFromFarToClose => {
                console.log('all signs from far to close: ', signsFromFarToClose);
                if (signsFromFarToClose.length > 0) {
                  fromS = crossStreet2;
                  gotoS = crossStreet1;
                }
                const rangeSmall2 = distanceToFarStreet - 50 > 0 ? distanceToFarStreet - 50 : 0;
                const rangeBig2 = distanceToFarStreet + 50;
                console.log(`the accuracy is between ${rangeSmall2}ft and ${rangeBig2}ft`);
                // find remove the signs smaller than lower limit
                signsFromFarToClose.forEach(signs => {
                  let side;
                  for (var i = 0; i < signs.length; i++) {
                    if (["W", "E", "N", "S"].includes(signs[i].side.trim())) {
                      side = signs[i].side.trim();
                      break
                    }
                  }
                  signs.forEach(sign => {
                    sign.side = side;
                    sign.fromStreet = fromS;
                    sign.gotoStreet = gotoS;
                  });
                  allsigns2 = allsigns2.concat(signs.filter(sign => parseInt(sign.distance) >= rangeSmall2))
                });
                if (allsigns2.length > 0) {
                  // sort by distance
                  allsigns2.sort(function (aSign2, bSign2) {
                    return parseInt(aSign2.distance) - parseInt(bSign2.distance);
                  })
                } else {
                  allsigns2 = [];
                }
                // find the upper limit
                let upperlimit2;
                for (var i = 0; i < allsigns2.length; i++) {
                  const newDistance = parseInt(allsigns2[i].distance);
                  if (newDistance === rangeBig2) {
                    upperlimit2 = rangeBig2;
                    break;
                  } else if (newDistance > rangeBig2) {
                    upperlimit2 = newDistance;
                    break;
                  }
                }
                upperlimit2 = upperlimit2 <= rangeBig2 ? rangeBig2 : upperlimit2;
                allsigns2 = allsigns2.filter(sign => parseInt(sign.distance) <= upperlimit2)
                return allsigns.concat(allsigns2);
              })
          }
          else {
            return [];
          }
        })
        .then(totalSigns => {
          console.log('following are possible parking rules in this area', totalSigns);
          return { totalSigns, mainStreet, crossStreet1, crossStreet2, fromS, gotoS }
        })
        .catch(err => console.log(err));
    })
}

/* Button creators ================================================ */
//....Exit Button
export function exitBtnCreator(){
    //Create Exit Navigation button for navigation
  var exitBtn = document.createElement('button')
  exitBtn.innerHTML = '<span class="glyphicon glyphicon-remove"></span>'
  exitBtn.className = 'btn btn-default directions-btn-exit hidden'
  //function to remove routes for navigation
  exitBtn.onclick = function() {
    mapDirection.removeRoutes()
    this.classList.toggle('hidden');
  }
  // Grabs directions ui and prepends btn
  var controls = document.getElementsByClassName('mapboxgl-ctrl-directions mapboxgl-ctrl')[0]
  controls.prepend(exitBtn);
}
//....Geo Marker Add Spot Button
export function geoMarkerBtnCreator(fnc){
  //first check if btn exists to stop multiple instaces
  if (document.getElementById('geo-marker-btn')) return

  var geoBtn = document.createElement('button')
  geoBtn.id = 'geo-marker-btn'
  geoBtn.innerHTML = 'Report Spot Here'
  geoBtn.className = 'btn btn-default btn-sm create-btn map-view-settings-button pull-right hidden'
  geoBtn.onclick = function() {
    return fnc() //fires the create spot at geo function via handleAddSpotGeo passed in
  }
  // Grabs map controls ui and prepends btn
  var controls = document.getElementById('report-spot-btn')
  controls.after(geoBtn);
}

//....Custom Marker Add Spot Button
export function customMarkerBtnCreator(fnc){
  //first check if btn exists to stop multiple instaces
  if (document.getElementById('custom-marker-btn')) return

  var customBtn = document.createElement('button')
  customBtn.id = 'custom-marker-btn'
  customBtn.innerHTML = 'Report Spot @Marker'
  customBtn.className = 'btn btn-default btn-sm create-btn map-view-settings-button pull-right hidden'
  customBtn.onclick = function() {
    return fnc() //fires the create spot at clicked marker function via handleAddSpotMarker passed in
  }
  // Grabs map controls ui and prepends btn
  var controls = document.getElementById('report-spot-btn')
  controls.after(customBtn);
}

//....Report Spot Button
export function reportSpotBtnCreator(toggleMenuFnc, geoFunc, markerFunc){
  //first check if btn exists to stop multiple instances
  if (document.getElementById('report-spot-btn')) return;

  var reportSpotBtn = document.createElement('button');
  reportSpotBtn.id = 'report-spot-btn';
  reportSpotBtn.innerHTML = 'Report Spot';
  reportSpotBtn.className = 'btn btn-default btn-sm create-btn map-view-settings-button pull-right';
  reportSpotBtn.onclick = function() {
    return toggleMenuFnc() //toggles menu
  };
  // Grabs map controls ui and prepends btn
  var controls = document.getElementsByClassName('mapboxgl-ctrl-bottom-right')[0];
  controls.prepend(reportSpotBtn);
  geoMarkerBtnCreator(geoFunc);
  customMarkerBtnCreator(markerFunc);
}

// set show and hidden classes on Report Spot menu button on Map and also changes innerHtml of 'Report Spot' button to 'X' when menu is open
export function setClasses(menuToggleBool){
  const customBtn = document.getElementById('custom-marker-btn');
  const geoBtn = document.getElementById('geo-marker-btn');
  const reportSpotBtn = document.getElementById('report-spot-btn');
  let geoBtnClasses = geoBtn.className;
  let customBtnClasses = customBtn.className;
  let reportSpotBtnInnerHTML = reportSpotBtn.innerHTML;
if (menuToggleBool === false) {
  if (customBtn.className.includes('show')){

    customBtnClasses = customBtnClasses.replace('show', 'hidden');
    geoBtnClasses = geoBtnClasses.replace('show', 'hidden');
  }
  if (reportSpotBtn.innerHTML.includes('X')){
    reportSpotBtnInnerHTML = reportSpotBtn.innerHTML.replace('X', 'Report Spot');
    }
}
if (menuToggleBool === true){
  if (customBtn.className.includes('hidden') ){
    customBtnClasses = customBtnClasses.replace('hidden', 'show');
    geoBtnClasses = geoBtnClasses.replace('hidden', 'show');

  }

  if (reportSpotBtn.innerHTML.includes('Report Spot')){
    reportSpotBtnInnerHTML = reportSpotBtn.innerHTML.replace('Report Spot', 'X');

  }
}
  customBtn.className = customBtnClasses;
  geoBtn.className = geoBtnClasses;
  reportSpotBtn.innerHTML = reportSpotBtnInnerHTML;
}

/* Modal creator ================================================ */
export function createImgModal(imgSrc){
  console.log('creating img:',imgSrc)
  // Get the modal
  var modal = document.getElementById('spotModal');
  // Insert it inside the modal
  var modalImg = document.getElementById("spotImgModal");
  modal.style.display = "block";
  modalImg.src = imgSrc;
  // Get the <span> element that closes the modal
  var span = document.getElementsByClassName("close")[0];
  // When the user clicks on <span> (x), close the modal
  span.onclick = function() {
      modal.style.display = "none";
  }
}
