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
      'READING': 'Reading',
      'FINISHED': 'Finished',
      'BACKLOG': 'BackLog',
      'ONHOLD': 'On-Hold',
      'DROPPED': 'Dropped'
   });

   /* credit:
   https://strongloop.com/strongblog/async-error-handling-expressjs-es7-promises-generators/
   */
   // default error handling wrapper for async functions
   let rejectHandler = fn => (...args) => fn(...args).catch(args[2]);

   // Add book to the user's list of books
   /* Example: /api/user/yoshino703/books/pg703?status=reading */
   app.put('/api/user/:id/books/:pgid', (req, res, next) => {
   
      // extract url data and query from request and store them
      const userUrl = getUserUrl(req.params.id);
      const bookUrl = getBookUrl(req.params.pgid);
      req.urlData = {userUrl, bookUrl};

      let readStatus = ReadStatus[req.query.status.toUpperCase()];
      if(readStatus === undefined) res.status(400).send('Invalid status!');
      req.queryData = {readStatus};
      next();
   }, rejectHandler( async(req, res, next) => {

      // request user and book in parallel
      const userOptions = {url: req.urlData.userUrl, json: true};
      const bookOptions = {url: req.urlData.bookUrl, json: true};
         
      try {
         const [userRes, bookRes] = await Promise.all([
            rp(userOptions),
            rp(bookOptions),
         ]);
         
         // extract user and book info from responses
         const {_source: user, _version: version} = userRes;
         const {_source: book} = bookRes;

         req.dbData = Object.freeze({version, user, book});
      } catch (esResErr) {
         res.status(esResErr.statusCode || 502).json(esResErr.error);
      };
      req.pendingUpdate = Object.freeze({
         id: req.params.pgid,
         title: req.dbData.book.title,
         status: req.queryData.readStatus
      });
      next();
   }), rejectHandler( async(req, res, next) => {
      
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

      // put the updated bundle back in the index
      try {
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
   }));
}