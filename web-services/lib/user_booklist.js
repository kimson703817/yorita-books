/*
 * Provides API endpoints for working with book lists
 */
'use strict';
const rp = require('request-promise');

module.exports = (app, es) => {

   const url = `http://${es.host}:${es.port}/${es.users_index}/user`;

   const getUserUrl = id => `${url}/${id}`

   const getBookUrl = pgid =>
      `http://${es.host}:${es.port}/${es.books_index}/book/${pgid}`;

   const ReadStatus = Object.freeze({
      "READING": 'Reading',
      "FINISHED": 'Finished',
      "BACKLOG": 'BackLog',
      "ONHOLD": 'On-Hold',
      "DROPPED": 'Dropped'
   });


   // Add book to the user's list of books
   // status query string must be ALL CAPS, default value is READING
   // /api/user/yoshino703/books/pg703?status="READING"
   app.put('/api/user/:id/books/:pgid', async(req, res, next) => {
   
      // extract url data and query from request and store them
      const userUrl = getUserUrl(req.params.id);
      const bookUrl = getBookUrl(req.params.pgid);
      req.urlData = {userUrl, bookUrl};

      let readStatus = ReadStatus[req.query.status];
      if(readStatus === undefined) readStatus = ReadStatus["READING"];
      req.queryData = {readStatus};
      next();
   
   }, async(req, res, next) => {

      try {
         // request user and book in parallel
         const userOptions = {url: req.urlData.userUrl, json: true};
         const bookOptions = {url: req.urlData.bookUrl, json: true};
         
         const [userRes, bookRes] = await Promise.all([
            rp(userOptions),
            rp(bookOptions),
         ]);
         
         // extract user and book info from responses
         const {_source: user, _version: version} = userRes;
         const {_source: book} = bookRes;

         req.dbData = Object.freeze({version, user, book});
         req.pendingUpdate = Object.freeze({
            id: req.params.pgid,
            title: book.title,
            status: req.queryData.readStatus
         });
      } catch (esResErr) {
         res.status(esResErr.statusCode || 502).json(esResErr.error);
      }
      next();
   }, async(req, res, next) => {

      const book_null = req.dbData.user.books
         .findIndex(bookToAdd => bookToAdd === null);
      if(book_null !== -1) {
         req.dbData.user.books.splice(book_null, 1);
      }
      // check to see if book is already in user's list
      const book_index = req.dbData.user.books
         .findIndex(bookToAdd => bookToAdd.id === req.params.pgid);

      if(book_index === -1) {
         // add to the user's book list if not found
         req.dbData.user.books.push(req.pendingUpdate);
      
      } else {
         // update the book's readStatus
         req.dbData.user.books.splice(book_index, 1, req.pendingUpdate);
      }
      console.log(req.dbData.user.books.length);
      try {
         // put the updated bundle back in the index
         const version = req.dbData.version;
         const esResBody = await rp.put( {
            url: req.urlData.userUrl,
            qs: { version },
            body: req.dbData.user,
            json: true,
         });
         res.status(200).json(esResBody);
      } catch (esResErr) {
         res.status(esResErr.statusCode || 502).json(esResErr.error);
      }
   });

}